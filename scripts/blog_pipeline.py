#!/usr/bin/env python3
"""
Automated blog pipeline for Phantom Cyber Solutions.
Generates blog posts from GitHub repos and RSS feeds, publishes to blog.json.
"""

import json
import subprocess
import base64
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any
import sys
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import feedparser
from anthropic import Anthropic

# ─── Configuration ──────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent
LIVE_BLOG = REPO_ROOT / "backend/build/data/blog.json"
CANON_BLOG = REPO_ROOT / "data/blog.json"
STATE_FILE = REPO_ROOT / "data/blog_pipeline_state.json"
GITHUB_USER = "RealPhantomLee"

RSS_FEEDS = [
    "https://krebsonsecurity.com/feed/",
    "https://threatpost.com/feed/",
    "https://www.darkreading.com/rss.xml",
    "https://www.bleepingcomputer.com/feed/",
    "https://feeds.feedburner.com/TheHackersNews",
    "https://news.ycombinator.com/rss",
    "https://dev.to/feed",
    "https://www.hackster.io/feed",
    "https://www.tomshardware.com/feeds/all",
    "https://feeds.arstechnica.com/arstechnica/index",
    "https://www.theverge.com/rss/index.xml",
]

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s — %(levelname)s — %(message)s")
logger = logging.getLogger(__name__)

# ─── State Management ──────────────────────────────────────────────────────

def load_state() -> Dict[str, Any]:
    """Load pipeline state, initializing on first run."""
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)

    # First run: fetch all repos and initialize state
    logger.info("First run detected, initializing state...")
    repos = get_github_repos()
    repo_names = [r["name"] for r in repos]

    state = {
        "mode": "github",
        "covered_repos": [],
        "github_repos_cache": repo_names,
        "used_rss_urls": [],
        "last_run": None,
    }
    save_state(state)
    return state

def save_state(state: Dict[str, Any]) -> None:
    """Save pipeline state to file."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
    logger.info("State saved.")

# ─── GitHub Integration ───────────────────────────────────────────────────

def get_github_repos() -> List[Dict[str, Any]]:
    """Fetch list of repos for GITHUB_USER via gh CLI."""
    try:
        result = subprocess.run(
            ["gh", "repo", "list", GITHUB_USER, "--json", "name,description,topics,primaryLanguage", "--limit", "100"],
            capture_output=True,
            text=True,
            check=True,
        )
        repos = json.loads(result.stdout)
        logger.info(f"Fetched {len(repos)} repos from GitHub.")
        return repos
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to fetch repos: {e.stderr}")
        return []

def get_repo_readme(repo_name: str) -> Optional[str]:
    """Fetch README content for a repo via gh CLI."""
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{GITHUB_USER}/{repo_name}/readme"],
            capture_output=True,
            text=True,
            check=True,
        )
        # GitHub API returns the file in raw content in the response
        data = json.loads(result.stdout)
        content = data.get("content", "")
        if content:
            return base64.b64decode(content).decode("utf-8", errors="ignore")
        return None
    except subprocess.CalledProcessError:
        logger.warning(f"No README found for {repo_name}")
        return None
    except Exception as e:
        logger.warning(f"Error fetching README for {repo_name}: {e}")
        return None

def get_next_github_repo(state: Dict[str, Any]) -> Optional[tuple]:
    """Get next uncovered repo. Returns (repo_name, readme, description, topics, language) or None."""
    covered = set(state["covered_repos"])
    all_repos = state.get("github_repos_cache", [])

    for repo_name in all_repos:
        if repo_name not in covered:
            # Fetch this repo's details
            repos = get_github_repos()
            repo_data = next((r for r in repos if r["name"] == repo_name), None)

            if not repo_data:
                logger.warning(f"Could not fetch details for {repo_name}")
                continue

            readme = get_repo_readme(repo_name)
            description = repo_data.get("description", "")
            topics = repo_data.get("topics", [])
            language = repo_data.get("primaryLanguage", {})
            if isinstance(language, dict):
                language = language.get("name", "")

            logger.info(f"Selected repo: {repo_name}")
            return (repo_name, readme or "", description, topics, language)

    logger.info("All repos covered, switching to RSS mode.")
    return None

# ─── RSS Integration ──────────────────────────────────────────────────────

def fetch_rss_feeds() -> List[Dict[str, Any]]:
    """Fetch all RSS feeds in parallel and collect entries."""
    entries = []

    def fetch_feed(url: str) -> List[Dict[str, Any]]:
        try:
            feed = feedparser.parse(url)
            result = []
            for entry in feed.entries[:10]:  # Limit per feed to avoid bloat
                result.append({
                    "title": entry.get("title", ""),
                    "link": entry.get("link", ""),
                    "summary": entry.get("summary", ""),
                    "published": entry.get("published_parsed", None),
                    "source": feed.feed.get("title", url),
                })
            logger.info(f"Fetched {len(result)} entries from {url}")
            return result
        except Exception as e:
            logger.warning(f"Failed to fetch {url}: {e}")
            return []

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(fetch_feed, url): url for url in RSS_FEEDS}
        for future in as_completed(futures):
            entries.extend(future.result())

    # Sort by published date descending
    entries.sort(key=lambda e: e.get("published") or (0,), reverse=True)
    return entries

def get_next_rss_article(state: Dict[str, Any]) -> Optional[tuple]:
    """Get next unused RSS article. Returns (title, url, summary, source) or None."""
    used_urls = set(state.get("used_rss_urls", []))
    entries = fetch_rss_feeds()

    for entry in entries:
        url = entry["link"]
        if url not in used_urls and url:
            logger.info(f"Selected RSS article: {entry['title']}")
            return (entry["title"], url, entry["summary"], entry["source"])

    logger.warning("No new RSS articles found, resetting used_urls.")
    state["used_rss_urls"] = []
    save_state(state)
    return get_next_rss_article(state)  # Recursive call to try again

# ─── Claude API Integration ───────────────────────────────────────────────

SYSTEM_PROMPT = """You are a blog writer for Phantom Cyber Solutions, a cybersecurity services company.
Write posts for a non-technical general audience.
Frame everything as "how this technology benefits regular people in their daily lives."
Never use jargon without immediately explaining it in plain English.
Always end with a soft call-to-action mentioning Phantom Cyber Solutions services.

Format your response as valid JSON with these keys:
{
  "title": "...",
  "excerpt": "...",
  "content": "...",
  "tags": [...],
  "category": "..."
}

The content should be 600-800 words, written in 3-4 paragraphs with clear headers."""

def generate_post(client: Anthropic, post_type: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Generate a blog post via Claude API."""
    try:
        if post_type == "github":
            repo_name, readme, description, topics, language = (
                data["repo_name"],
                data["readme"],
                data["description"],
                data["topics"],
                data["language"],
            )
            user_prompt = f"""Generate a blog post about this GitHub project:

Repository: {repo_name}
Description: {description}
Topics: {', '.join(topics) if topics else 'N/A'}
Primary Language: {language or 'N/A'}

README (first 2000 chars):
{(readme or '')[:2000]}

Write a 600-800 word post explaining what this project does and how its concepts benefit regular people in their daily lives.
Include specific, relatable scenarios. Use a friendly, accessible tone."""
        else:  # RSS post
            title, url, summary, source = (
                data["title"],
                data["url"],
                data["summary"],
                data["source"],
            )
            user_prompt = f"""Generate a blog post based on this tech news story:

Title: {title}
Source: {source}
Summary: {summary}
URL: {url}

Write a 600-800 word post explaining what this news story means for everyday people and how they can protect themselves or benefit from this development.
Use a friendly, accessible tone without technical jargon."""

        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1500,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": user_prompt,
                }
            ],
        )

        response_text = message.content[0].text
        post_data = json.loads(response_text)
        logger.info(f"Generated post: {post_data['title']}")
        return post_data
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Claude response as JSON: {e}")
        logger.error(f"Response was: {response_text[:200]}")
        return None
    except Exception as e:
        logger.error(f"Failed to generate post via Claude API: {e}")
        return None

# ─── Blog JSON Writing ───────────────────────────────────────────────────

def write_post(post_data: Dict[str, Any], post_id: str) -> bool:
    """Append post to both live and canonical blog.json files."""
    try:
        post_entry = {
            "author": "Phantom Cyber Solutions",
            "category": post_data.get("category", "cybersecurity"),
            "content": post_data["content"],
            "date": datetime.now().strftime("%Y-%m-%d"),
            "excerpt": post_data["excerpt"],
            "id": post_id,
            "published": True,
            "tags": post_data.get("tags", []),
            "title": post_data["title"],
        }

        # Write to both paths
        for blog_path in [LIVE_BLOG, CANON_BLOG]:
            blog_path.parent.mkdir(parents=True, exist_ok=True)

            if blog_path.exists():
                with open(blog_path) as f:
                    data = json.load(f)
            else:
                data = {"posts": [], "settings": {
                    "admin_only_posting": True,
                    "allow_comments": False,
                    "posts_per_page": 10
                }}

            if "posts" not in data:
                data["posts"] = []

            data["posts"].insert(0, post_entry)  # Prepend new post

            # Write atomically
            tmp_file = blog_path.with_suffix(".json.tmp")
            with open(tmp_file, "w") as f:
                json.dump(data, f, indent=2)
            tmp_file.replace(blog_path)
            logger.info(f"Posted to {blog_path}")

        return True
    except Exception as e:
        logger.error(f"Failed to write post: {e}")
        return False

# ─── Main Pipeline ────────────────────────────────────────────────────────

def main():
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY not set")
        sys.exit(1)

    client = Anthropic(api_key=api_key)

    state = load_state()
    logger.info(f"Pipeline mode: {state['mode']}")

    post_data = None
    post_id = None

    if state["mode"] == "github":
        repo_info = get_next_github_repo(state)
        if repo_info:
            repo_name, readme, description, topics, language = repo_info
            post_data = generate_post(client, "github", {
                "repo_name": repo_name,
                "readme": readme,
                "description": description,
                "topics": topics,
                "language": language,
            })
            if post_data:
                post_id = f"{repo_name.lower().replace(' ', '-')}-{datetime.now().strftime('%Y-%m-%d')}"
                state["covered_repos"].append(repo_name)
        else:
            # Switch to RSS mode
            state["mode"] = "rss"

    if state["mode"] == "rss" and not post_data:
        article_info = get_next_rss_article(state)
        if article_info:
            title, url, summary, source = article_info
            post_data = generate_post(client, "rss", {
                "title": title,
                "url": url,
                "summary": summary,
                "source": source,
            })
            if post_data:
                url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
                post_id = f"news-{url_hash}"
                state["used_rss_urls"].append(url)

    if post_data and post_id:
        if write_post(post_data, post_id):
            logger.info("✓ Blog post published successfully")
            state["last_run"] = datetime.now().isoformat()
            save_state(state)
            sys.exit(0)

    logger.error("✗ Failed to generate or publish blog post")
    sys.exit(1)

if __name__ == "__main__":
    main()
