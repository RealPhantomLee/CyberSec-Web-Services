// Checkout page JavaScript
document.addEventListener('DOMContentLoaded', function() {
    loadCheckout();
    
    const checkoutBtn = document.getElementById('checkout-button');
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', function() {
            initiateStripeCheckout();
        });
    }
});

let cart = JSON.parse(localStorage.getItem('cart') || '[]');

function loadCheckout() {
    const itemsDiv = document.getElementById('checkout-items');
    const totalDiv = document.getElementById('checkout-total');
    
    if (!itemsDiv || !totalDiv) return;
    
    if (cart.length === 0) {
        itemsDiv.innerHTML = '<p style="color: var(--medium-gray);">Your cart is empty. <a href="/services">Browse services</a></p>';
        totalDiv.textContent = '$0.00';
        return;
    }
    
    let total = 0;
    itemsDiv.innerHTML = cart.map(item => {
        total += item.price;
        return `
            <div class="checkout-item">
                <span>${item.name}</span>
                <span>$${(item.price / 100).toFixed(2)}</span>
            </div>
        `;
    }).join('');
    
    totalDiv.textContent = `$${(total / 100).toFixed(2)}`;
}

function initiateStripeCheckout() {
    if (cart.length === 0) {
        showToast('Your cart is empty');
        return;
    }

    const btn = document.getElementById('checkout-button');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'PROCESSING...';
    }

    fetch('/api/checkout/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart })
    })
    .then(res => {
        if (res.status === 503) {
            showToast('Online payment not available yet — redirecting to contact');
            setTimeout(() => { window.location.href = 'contact.html'; }, 2200);
            if (btn) { btn.disabled = false; btn.textContent = 'COMPLETE MISSION →'; }
            return null;
        }
        return res.json();
    })
    .then(data => {
        if (!data) return;
        if (data.url) {
            window.location.href = data.url;
        } else {
            showToast(data.error || 'Checkout error — please try again');
            if (btn) { btn.disabled = false; btn.textContent = 'COMPLETE MISSION →'; }
        }
    })
    .catch(() => {
        showToast('Connection error — please try again');
        if (btn) { btn.disabled = false; btn.textContent = 'COMPLETE MISSION →'; }
    });
}
