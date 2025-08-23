  // Domain section
  const currentDomainDiv = document.getElementById('current-domain');
  const domainInput = document.getElementById('domain-input');
  const domainForm = document.getElementById('domain-form');
  const domainStatus = document.getElementById('domain-status');

  // Fetch current domain
  fetch('/api/admin/domain-config', {
    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('adm_token') }
  })
    .then(r => r.json())
    .then(cfg => {
      if (cfg.domain) currentDomainDiv.textContent = 'Current domain: ' + cfg.domain;
    });

  domainForm.addEventListener('submit', function(e) {
    e.preventDefault();
    domainStatus.textContent = 'Saving...';
    fetch('/api/admin/domain-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('adm_token')
      },
      body: JSON.stringify({ domain: domainInput.value })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          domainStatus.textContent = 'Domain updated!';
          currentDomainDiv.textContent = 'Current domain: ' + domainInput.value;
        } else {
          domainStatus.textContent = data.error || 'Failed to update.';
        }
      });
  });
  // Email section
  const currentEmailDiv = document.getElementById('current-email');
  const newEmailInput = document.getElementById('new-email');
  const newEmailPassInput = document.getElementById('new-email-pass');
  const emailForm = document.getElementById('email-form');
  const emailStatus = document.getElementById('email-status');

  // Fetch current sender email
  fetch('/api/admin/email-config', {
    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('adm_token') }
  })
    .then(r => r.json())
    .then(cfg => {
      if (cfg.emailUser) currentEmailDiv.textContent = 'Current sender email: ' + cfg.emailUser;
    });

  emailForm.addEventListener('submit', function(e) {
    e.preventDefault();
    emailStatus.textContent = 'Saving...';
    fetch('/api/admin/email-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('adm_token')
      },
      body: JSON.stringify({
        emailUser: newEmailInput.value,
        emailPass: newEmailPassInput.value
      })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          emailStatus.textContent = 'Sender email updated!';
          currentEmailDiv.textContent = 'Current sender email: ' + newEmailInput.value;
        } else {
          emailStatus.textContent = data.error || 'Failed to update.';
        }
      });
  });
// payment-gateway-admin.js
// Admin-only logic for updating PayPal account email

document.addEventListener('DOMContentLoaded', function() {
  // PayPal config
  const paypalEmailInput = document.getElementById('paypal-email');
  const paypalClientIdInput = document.getElementById('paypal-client-id');
  const paypalClientSecretInput = document.getElementById('paypal-client-secret');
  const paypalEnvInput = document.getElementById('paypal-env');
  const paypalConfigForm = document.getElementById('paypal-config-form');
  const paypalConfigStatus = document.getElementById('paypal-config-status');

  // Payout details
  const payoutForm = document.getElementById('payout-form');
  const payoutPaypalInput = document.getElementById('payout-paypal');
  const payoutBankInput = document.getElementById('payout-bank');
  const payoutCardInput = document.getElementById('payout-card');
  const payoutStatus = document.getElementById('payout-status');

  // Payout option
  const savePayoutOptionBtn = document.getElementById('savePayoutOption');
  const payoutOptionStatus = document.getElementById('payoutOption-status');

  // Fetch current PayPal config
  fetch('/api/admin/paypal-config', {
    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('adm_token') }
  })
    .then(r => r.json())
    .then(cfg => {
      if (cfg.paypalEmail) paypalEmailInput.value = cfg.paypalEmail;
      if (cfg.clientId) paypalClientIdInput.value = cfg.clientId;
      if (cfg.clientSecret) paypalClientSecretInput.value = cfg.clientSecret;
      if (cfg.env) paypalEnvInput.value = cfg.env;
      if (cfg.payoutPaypal) payoutPaypalInput.value = cfg.payoutPaypal;
      if (cfg.payoutBank) payoutBankInput.value = cfg.payoutBank;
      if (cfg.payoutCard) payoutCardInput.value = cfg.payoutCard;
      if (cfg.payoutOption) {
        document.querySelectorAll('input[name="payoutOption"]').forEach(radio => {
          radio.checked = (radio.value === cfg.payoutOption);
        });
      }
    });

  paypalConfigForm.addEventListener('submit', function(e) {
    e.preventDefault();
    paypalConfigStatus.textContent = 'Saving...';
    fetch('/api/admin/paypal-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('adm_token')
      },
      body: JSON.stringify({
        paypalEmail: paypalEmailInput.value,
        clientId: paypalClientIdInput.value,
        clientSecret: paypalClientSecretInput.value,
        env: paypalEnvInput.value
      })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          paypalConfigStatus.textContent = 'PayPal configuration updated!';
        } else {
          paypalConfigStatus.textContent = data.error || 'Failed to update.';
        }
      });
  });

  payoutForm.addEventListener('submit', function(e) {
    e.preventDefault();
    payoutStatus.textContent = 'Saving...';
    fetch('/api/admin/paypal-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('adm_token')
      },
      body: JSON.stringify({
        payoutPaypal: payoutPaypalInput.value,
        payoutBank: payoutBankInput.value,
        payoutCard: payoutCardInput.value
      })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          payoutStatus.textContent = 'Payout details saved!';
        } else {
          payoutStatus.textContent = data.error || 'Failed to save.';
        }
      });
  });

  savePayoutOptionBtn.addEventListener('click', function(e) {
    e.preventDefault();
    payoutOptionStatus.textContent = 'Saving...';
    const selected = document.querySelector('input[name="payoutOption"]:checked').value;
    fetch('/api/admin/paypal-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('adm_token')
      },
      body: JSON.stringify({ payoutOption: selected })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          payoutOptionStatus.textContent = 'Payout option saved!';
        } else {
          payoutOptionStatus.textContent = data.error || 'Failed to save.';
        }
      });
  });
});
