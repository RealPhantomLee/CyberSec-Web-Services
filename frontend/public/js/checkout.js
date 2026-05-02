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
        alert('Your cart is empty!');
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
    .then(res => res.json())
    .then(data => {
        if (data.url) {
            window.location.href = data.url;
        } else {
            alert('Checkout error: ' + (data.error || 'Unknown error. Please try again.'));
            if (btn) { btn.disabled = false; btn.textContent = 'COMPLETE MISSION →'; }
        }
    })
    .catch(() => {
        alert('Checkout error. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = 'COMPLETE MISSION →'; }
    });
}
