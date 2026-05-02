// Main JavaScript for CyberSec Web Services
document.addEventListener('DOMContentLoaded', function() {
    loadServices();
    loadProducts();
    loadBlogPosts();
});

// Load services from API or JSON file
async function loadServices() {
    const grid = document.getElementById('services-grid');
    if (!grid) return;

    try {
        // Try API first, fallback to JSON file for preview
        let data;
        try {
            const response = await fetch('/api/services');
            data = await response.json();
        } catch(e) {
            const response = await fetch('./services.json');
            data = await response.json();
        }
        
        grid.innerHTML = data.services.map(service => `
            <div class="service-card">
                ${service.badge ? `<div class="service-badge">${service.badge}</div>` : ''}
                <h3>${service.name}</h3>
                ${service.tagline ? `<div class="service-tagline">${service.tagline}</div>` : ''}
                <div class="price">$${(service.price / 100).toFixed(2)} <span>/ ${service.unit || 'project'}</span></div>
                <p>${service.description}</p>
                <ul>
                    ${(service.features || []).slice(0, 6).map(f => `<li>${f}</li>`).join('')}
                </ul>
                ${service.timeline ? `<div class="service-meta"><span class="service-meta-label">Timeline:</span> ${service.timeline}</div>` : ''}
                <div class="service-actions">
                    <button class="cta-button" style="flex:1;" onclick="addToCart('${service.id}', '${service.name}', ${service.price})">Add to Cart</button>
                    <a href="quote.html" class="cta-button-ghost" style="flex:1;text-align:center;padding:0.9rem 1rem;">Get Quote</a>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading services:', error);
        grid.innerHTML = '<p style="color: var(--medium-gray);">Unable to load services.</p>';
    }
}

// Load products/add-ons from API or JSON file
async function loadProducts() {
    const grid = document.getElementById('products-grid');
    if (!grid) return;

    try {
        let data;
        try {
            const response = await fetch('/api/products');
            data = await response.json();
        } catch(e) {
            const response = await fetch('./products.json');
            data = await response.json();
        }
        
        grid.innerHTML = data.addons.map(product => `
            <div class="product-card">
                <h4>${product.name}</h4>
                <div class="price">$${(product.price / 100).toFixed(2)}</div>
                <p>${product.description}</p>
                <button class="cta-button" style="padding: 0.55rem 1.1rem; font-size: 0.78rem;" onclick="addToCart('${product.id}', '${product.name}', ${product.price})">
                    Add to Cart
                </button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading products:', error);
        grid.innerHTML = '<p style="color: var(--medium-gray);">Unable to load products.</p>';
    }
}

// Load blog posts from API or JSON file
async function loadBlogPosts() {
    const grid = document.getElementById('blog-grid');
    if (!grid) return;

    try {
        let posts;
        try {
            const response = await fetch('/api/blog');
            posts = await response.json();
        } catch(e) {
            const response = await fetch('./blog.json');
            const data = await response.json();
            posts = data.posts.filter(p => p.published);
        }
        
        grid.innerHTML = posts.map(post => `
            <div class="blog-card">
                <div class="blog-image">&gt;_</div>
                <div class="blog-content">
                    <span class="blog-category">${post.category}</span>
                    <h3>${post.title}</h3>
                    <p class="excerpt">${post.excerpt}</p>
                    <small>${post.date}</small>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading blog posts:', error);
        grid.innerHTML = '<p style="color: var(--medium-gray);">Unable to load blog posts.</p>';
    }
}

// Cart functionality (stored in localStorage)
let cart = JSON.parse(localStorage.getItem('cart') || '[]');

function addToCart(id, name, price) {
    cart.push({ id, name, price });
    localStorage.setItem('cart', JSON.stringify(cart));
    showToast(`${name} added to cart`);
    updateCartCount();
}

function updateCartCount() {
    document.dispatchEvent(new CustomEvent('cartUpdated'));
    const badge = document.getElementById('cart-badge');
    if (!badge) return;
    const count = cart.length;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

function showToast(message) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = '// ' + message;
    document.body.appendChild(t);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => t.classList.add('toast-show'));
    });
    setTimeout(() => {
        t.classList.remove('toast-show');
        setTimeout(() => t.remove(), 300);
    }, 2600);
}

function updateCartCount() {
    const count = cart.length;
    // You can add a cart counter to the nav here
}

// Init checkout page if on checkout
if (window.location.pathname === '/checkout') {
    loadCheckout();
}

async function loadCheckout() {
    const itemsDiv = document.getElementById('checkout-items');
    const totalDiv = document.getElementById('checkout-total');
    
    if (!itemsDiv || !totalDiv) return;
    
    let total = 0;
    itemsDiv.innerHTML = cart.map(item => {
        total += item.price;
        return `
            <div class="checkout-item">
                <span>${item.name}</span>
                <span>$${(item.price / 100).toFixed(2)}</span>
            </div>
        `;
    }).join('') + (cart.length === 0 ? '<p style="color: var(--medium-gray);">Your cart is empty.</p>' : '');
    
    totalDiv.textContent = `$${(total / 100).toFixed(2)}`;
}
