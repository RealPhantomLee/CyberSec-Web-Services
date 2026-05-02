import os
import json
import re

PROJECT_ROOT = "/home/kali/Projects"
OUTPUT_FILE = "/home/kali/Projects/portfolio-site/data/portfolio.json"

IGNORE_FOLDERS = [
"portfolio-site",
".git",
"Cloud-Cells",
"Brick-Stack"
]


TITLE_MAP = {

"Azure Fundamentals":
"Azure Infrastructure Security Lab",

"Azure Security Hardening & Monitoring Lab":
"Azure Security Hardening & Monitoring",

"Interface HUD Operator Controls":
"Security Operations HUD Interface",

"Logging SIEM Wazuh":
"SIEM Monitoring & Log Analysis Lab",

"Repo & Sync":
"Security Lab Repository Management System",

"System Backup":
"System Backup & Recovery Lab",

"Toolchain Layer":
"Security Toolchain Environment",

"Live USB with Encrypted Persistence":
"Encrypted Live Security Environment",

"Live USB Auto Time Sync On Network Connection":
"Network Time Synchronization Service",

"Cyberdeck":
"Portable Cybersecurity Workstation"

}


LAYER_MAP = {

"Azure Infrastructure Security Lab": "cloud",

"Azure Security Hardening & Monitoring": "cloud",

"SIEM Monitoring & Log Analysis Lab": "monitoring",

"Vulnerability Management Lab": "monitoring",

"Security Operations HUD Interface": "operations",

"Security Toolchain Environment": "toolchain",

"Encrypted Live Security Environment": "toolchain",

"Portable Cybersecurity Workstation": "infrastructure",

"System Backup & Recovery Lab": "infrastructure",

"Network Time Synchronization Service": "infrastructure",

"Security Lab Repository Management System": "infrastructure"

}


DESCRIPTION_MAP = {

"Azure Infrastructure Security Lab":
"Deployment and configuration of Azure infrastructure including virtual machines, networking and security controls.",

"Azure Security Hardening & Monitoring":
"Cloud security lab implementing identity controls, network restrictions and monitoring for Azure resources.",

"SIEM Monitoring & Log Analysis Lab":
"Centralized logging environment using Wazuh to collect, analyze and alert on security events.",

"Vulnerability Management Lab":
"End-to-end vulnerability scanning workflow including discovery, triage and remediation verification.",

"Security Operations HUD Interface":
"Custom command interface designed to operate security tools and manage monitoring workflows.",

"Security Toolchain Environment":
"Integrated environment of security tools used for scanning, analysis and incident investigation.",

"Encrypted Live Security Environment":
"Portable Linux environment with encrypted persistence for secure security operations.",

"Portable Cybersecurity Workstation":
"Custom cyberdeck workstation designed for portable security testing and analysis.",

"System Backup & Recovery Lab":
"Automated backup workflow protecting system configurations and lab environments.",

"Network Time Synchronization Service":
"Network-based time synchronization system ensuring accurate timestamps across infrastructure.",

"Security Lab Repository Management System":
"Git-based workflow managing cybersecurity labs, documentation and version control."

}


ICON_MAP = {

"cloud": "cloud",

"monitoring": "radar",

"operations": "terminal",

"toolchain": "tools",

"infrastructure": "server"

}


projects = []


def clean_title(folder_name):

    name = folder_name.replace("_", " ")
    name = re.sub(r"Brick\s*#?\d+\s*-\s*", "", name)
    name = re.sub(r"Cell\s*[A-Z]\s*-\s*", "", name)
    name = name.strip()

    if name in TITLE_MAP:
        return TITLE_MAP[name]

    return name


def slugify(title):

    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


for root, dirs, files in os.walk(PROJECT_ROOT):

    for d in dirs:

        if d in IGNORE_FOLDERS:
            continue

        if "Brick" not in d and "Cell" not in d:
            continue

        title = clean_title(d)

        slug = slugify(title)

        description = DESCRIPTION_MAP.get(
            title,
            "Cybersecurity lab focused on infrastructure security and operational workflows."
        )

        layer = LAYER_MAP.get(title, "infrastructure")

        icon = ICON_MAP.get(layer, "shield")

        project = {
            "title": title,
            "description": description,
            "icon": icon,
            "slug": slug,
            "layer": layer
        }

        projects.append(project)


projects = sorted(projects, key=lambda x: x["title"])


with open(OUTPUT_FILE, "w") as f:
    json.dump(projects, f, indent=4)


print("Portfolio rebuilt:", len(projects), "projects")
