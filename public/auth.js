/*
 * ReadyAd auth: Supabase Auth UI (modal + header) and guest limits.
 * Plain JS, no framework. Depends on supabase-config.js and the markup in index.html.
 */
(function () {
  'use strict';

  var FREE_LIMIT = 3;
  var GUEST_KEY = 'readyad-guest-count';
  var OAUTH_PROVIDER_KEY = 'readyad-oauth-provider';

  var ready = (window.ReadyAdSupabase && window.ReadyAdSupabase.ready) || Promise.reject(new Error('Supabase config missing'));

  var els = {};
  var client = null;
  var currentUser = null;
  var currentSession = null;
  var initialized = false;
  var lastFocused = null;
  var oauthPending = false;

  function $(id) { return document.getElementById(id); }

  function cacheEls() {
    els.modal = $('auth-modal');
    if (!els.modal) return;
    els.panel = els.modal.querySelector('.auth-panel');
    els.closeBtn = els.modal.querySelector('.auth-close');
    els.title = $('auth-title');
    els.subtitle = $('auth-subtitle');
    els.form = $('auth-form');
    els.oauthSection = $('auth-oauth');
    els.divider = $('auth-divider');
    els.email = $('auth-email');
    els.emailRow = $('auth-email-row');
    els.passwordRow = $('auth-password-row');
    els.password = $('auth-password');
    els.passwordToggle = $('auth-password-toggle');
    els.submit = $('auth-submit');
    els.submitLabel = $('auth-submit-label');
    els.error = $('auth-error');
    els.success = $('auth-success');
    els.forgotBtn = $('auth-forgot');
    els.switchText = $('auth-switch-text');
    els.switchBtn = $('auth-switch');
    els.guestNote = $('auth-guest-note');
    els.mode = els.modal.getAttribute('data-mode') || 'signin';
  }

  /* ----------------------------- guest counter ----------------------------- */

  function getGuestCount() {
    try {
      var n = parseInt(localStorage.getItem(GUEST_KEY) || '0', 10);
      return isNaN(n) || n < 0 ? 0 : n;
    } catch (e) {
      return 0;
    }
  }

  function setGuestCount(n) {
    try { localStorage.setItem(GUEST_KEY, String(n)); } catch (e) {}
    updateGuestNote();
  }

  function incrementGuest() {
    var n = getGuestCount() + 1;
    setGuestCount(n);
    return n;
  }

  function updateGuestNote() {
    if (!els.guestNote) return;
    if (currentUser) {
      els.guestNote.textContent = '';
      els.guestNote.classList.add('hidden');
      return;
    }
    var left = Math.max(0, FREE_LIMIT - getGuestCount());
    els.guestNote.textContent = left + ' of ' + FREE_LIMIT + ' free ads left';
    els.guestNote.classList.remove('hidden');
  }

  /* ------------------------------ ui helpers ------------------------------- */

  function setLoading(button, loading, label) {
    if (!button) return;
    if (loading) {
      if (!button.querySelector('.spinner')) {
        var sp = document.createElement('span');
        sp.className = 'spinner auth-spinner';
        button.insertBefore(sp, button.firstChild);
      }
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      if (label && els.submitLabel) els.submitLabel.textContent = label;
    } else {
      var spin = button.querySelector('.spinner');
      if (spin) spin.remove();
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (els.submitLabel) {
        var labels = { signin: 'Sign in', signup: 'Sign up', reset: 'Send reset link', newpassword: 'Update password' };
        els.submitLabel.textContent = labels[els.mode] || 'Sign in';
      }
    }
  }

  function clearMessages() {
    if (els.error) { els.error.textContent = ''; els.error.classList.add('hidden'); }
    if (els.success) { els.success.textContent = ''; els.success.classList.add('hidden'); }
  }

  function showError(msg) {
    if (!els.error) return;
    els.error.textContent = msg;
    els.error.classList.remove('hidden');
    els.error.classList.add('auth-msg');
    if (els.success) els.success.classList.add('hidden');
  }

  function showSuccess(msg) {
    if (!els.success) return;
    els.success.textContent = msg;
    els.success.classList.remove('hidden');
    els.success.classList.add('auth-msg');
    if (els.error) els.error.classList.add('hidden');
  }

  function friendlyError(message, status) {
    var m = String(message || '').toLowerCase();
    if (!message) return 'Something went wrong. Please try again.';
    if (m.indexOf('invalid login credentials') !== -1) return 'That email or password is incorrect.';
    if (m.indexOf('email not confirmed') !== -1) return 'Please confirm your email first, then sign in.';
    if (m.indexOf('user already registered') !== -1 || m.indexOf('already been registered') !== -1) return 'An account with this email already exists. Try signing in.';
    if (m.indexOf('password') !== -1 && m.indexOf('least') !== -1) return 'Password must be at least 6 characters.';
    if (m.indexOf('unable to validate email') !== -1 || m.indexOf('invalid email') !== -1) return 'Please enter a valid email address.';
    if (m.indexOf('rate limit') !== -1 || m.indexOf('too many') !== -1) return 'Too many attempts. Please wait a minute and try again.';
    if (m.indexOf('failed to fetch') !== -1 || m.indexOf('network') !== -1) return 'Could not reach the server. Check your connection.';
    if (m.indexOf('provider') !== -1 && m.indexOf('not enabled') !== -1) return 'This sign-in method is not enabled yet.';
    if (status === 429) return 'Too many attempts. Please wait a minute and try again.';
    if (status >= 500) return 'Server is having a moment. Please try again.';
    return message;
  }

  /* -------------------------------- modal ---------------------------------- */

  function setMode(mode) {
    els.mode = mode;
    els.modal.setAttribute('data-mode', mode);
    clearMessages();
    if (els.submit) els.submit.disabled = false;
    if (els.email) els.email.classList.remove('input-error');
    if (els.password) els.password.classList.remove('input-error');

    if (mode === 'signup') {
      els.title.textContent = 'Create your account';
      els.subtitle.textContent = 'Sign up to keep creating ads.';
      els.submitLabel.textContent = 'Sign up';
      els.password.setAttribute('autocomplete', 'new-password');
      els.passwordRow.classList.remove('hidden');
      els.forgotBtn.classList.add('hidden');
      els.switchText.textContent = 'Already have an account?';
      els.switchBtn.textContent = 'Sign in';
      els.switchBtn.classList.remove('hidden');
    } else if (mode === 'reset') {
      els.title.textContent = 'Reset your password';
      els.subtitle.textContent = "Enter your email and we'll send a reset link.";
      els.submitLabel.textContent = 'Send reset link';
      els.password.setAttribute('autocomplete', 'current-password');
      els.passwordRow.classList.add('hidden');
      els.forgotBtn.classList.add('hidden');
      els.switchText.textContent = 'Remembered it?';
      els.switchBtn.textContent = 'Back to sign in';
      els.switchBtn.classList.remove('hidden');
    } else if (mode === 'newpassword') {
      els.title.textContent = 'Set a new password';
      els.subtitle.textContent = 'Choose a new password for your account.';
      els.submitLabel.textContent = 'Update password';
      els.password.setAttribute('autocomplete', 'new-password');
      els.password.value = '';
      els.passwordRow.classList.remove('hidden');
      els.forgotBtn.classList.add('hidden');
      els.switchText.textContent = '';
      els.switchBtn.classList.add('hidden');
    } else {
      els.mode = 'signin';
      els.modal.setAttribute('data-mode', 'signin');
      els.title.textContent = 'Welcome back';
      els.subtitle.textContent = 'Sign in to keep creating ads.';
      els.submitLabel.textContent = 'Sign in';
      els.password.setAttribute('autocomplete', 'current-password');
      els.passwordRow.classList.remove('hidden');
      els.forgotBtn.classList.remove('hidden');
      els.switchText.textContent = 'New here?';
      els.switchBtn.textContent = 'Create an account';
      els.switchBtn.classList.remove('hidden');
    }
    updateGuestNote();
  }

  function openModal(mode) {
    if (!els.modal) return;
    lastFocused = document.activeElement;
    setMode(mode || 'signin');
    els.modal.classList.remove('hidden');
    els.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('auth-modal-open');
    var focusTarget = els.email && !els.emailRow.classList.contains('hidden') ? els.email : els.submit;
    if (focusTarget) {
      setTimeout(function () { try { focusTarget.focus(); } catch (e) {} }, 30);
    }
    document.addEventListener('keydown', onModalKeydown);
  }

  function closeModal() {
    if (!els.modal || els.modal.classList.contains('hidden')) return;
    els.modal.classList.add('hidden');
    els.modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('auth-modal-open');
    document.removeEventListener('keydown', onModalKeydown);
    setLoading(els.submit, false);
    if (els.passwordToggle) {
      els.passwordToggle.setAttribute('aria-pressed', 'false');
      els.passwordToggle.textContent = 'Show';
      els.password.type = 'password';
    }
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus(); } catch (e) {}
    }
    lastFocused = null;
  }

  function focusables() {
    if (!els.panel) return [];
    return Array.prototype.filter.call(
      els.panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) { return !el.disabled && el.getClientRects().length > 0; }
    );
  }

  function onModalKeydown(e) {
    if (!els.modal || els.modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === 'Tab') {
      var f = focusables();
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  /* ------------------------------- header ---------------------------------- */

  function initialsFor(user) {
    var meta = (user && user.user_metadata) || {};
    var name = meta.full_name || meta.name || meta.preferred_username || '';
    if (name) {
      var parts = String(name).trim().split(/\s+/);
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    var email = (user && user.email) || '';
    return email ? email.slice(0, 2).toUpperCase() : '?';
  }

  function avatarUrlFor(user) {
    var meta = (user && user.user_metadata) || {};
    return meta.avatar_url || meta.picture || '';
  }

  function renderHeader() {
    var slot = $('auth-slot');
    if (!slot) return;
    slot.innerHTML = '';

    if (!currentUser) {
      var signin = document.createElement('button');
      signin.type = 'button';
      signin.className = 'auth-signin-btn';
      signin.textContent = 'Sign in';
      signin.addEventListener('click', function () { openModal('signin'); });
      slot.appendChild(signin);
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'auth-user';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'auth-user-btn';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Account menu');

    var avatar = document.createElement('span');
    avatar.className = 'auth-avatar';
    var url = avatarUrlFor(currentUser);
    if (url) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', function () {
        avatar.textContent = initialsFor(currentUser);
        avatar.classList.add('is-initials');
      });
      avatar.appendChild(img);
    } else {
      avatar.textContent = initialsFor(currentUser);
      avatar.classList.add('is-initials');
    }
    btn.appendChild(avatar);

    var caret = document.createElement('span');
    caret.className = 'auth-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    btn.appendChild(caret);

    var menu = document.createElement('div');
    menu.className = 'auth-menu hidden';
    menu.setAttribute('role', 'menu');

    var emailRow = document.createElement('div');
    emailRow.className = 'auth-menu-email';
    emailRow.textContent = (currentUser && currentUser.email) || '';
    menu.appendChild(emailRow);

    var divider = document.createElement('div');
    divider.className = 'auth-menu-sep';
    menu.appendChild(divider);

    var logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'auth-menu-item';
    logout.setAttribute('role', 'menuitem');
    logout.textContent = 'Logout';
    logout.addEventListener('click', function (e) {
      e.stopPropagation();
      closeMenu();
      signOut();
    });
    menu.appendChild(logout);

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    slot.appendChild(wrap);

    function closeMenu() {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.classList.contains('hidden')) openMenu(); else closeMenu();
    });
    document.addEventListener('click', function (e) {
      if (!menu.classList.contains('hidden') && !wrap.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.classList.contains('hidden')) {
        closeMenu();
        btn.focus();
      }
    });
  }

  /* ------------------------------ auth actions ----------------------------- */

  function redirectUrl() {
    return window.location.origin + window.location.pathname;
  }

  function signInWithProvider(provider) {
    if (!client) return;
    clearMessages();
    try { sessionStorage.setItem(OAUTH_PROVIDER_KEY, provider); } catch (e) {}
    client.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: redirectUrl() }
    }).then(function (result) {
      if (result && result.error) {
        showError(friendlyError(result.error.message));
      }
      if (result && result.data && result.data.url) {
        window.location.href = result.data.url;
      }
    });
  }

  function signOut() {
    if (!client) return;
    client.auth.signOut().then(function () {
      currentUser = null;
      currentSession = null;
      renderHeader();
      updateGuestNote();
      var toast = $('toast');
      if (toast) {
        toast.textContent = 'Signed out';
        toast.classList.add('show');
        setTimeout(function () { toast.classList.remove('show'); }, 1600);
      }
    });
  }

  /* -------------------------------- events --------------------------------- */

  function bindEvents() {
    if (!els.modal) return;

    Array.prototype.forEach.call(els.modal.querySelectorAll('[data-auth-close]'), function (el) {
      el.addEventListener('click', closeModal);
    });
    els.modal.addEventListener('click', function (e) {
      if (e.target === els.modal) closeModal();
    });

    if (els.switchBtn) {
      els.switchBtn.addEventListener('click', function () {
        if (els.mode === 'signup') setMode('signin');
        else if (els.mode === 'reset') setMode('signin');
        else setMode('signup');
        if (els.email) els.email.focus();
      });
    }
    if (els.forgotBtn) {
      els.forgotBtn.addEventListener('click', function () {
        setMode('reset');
        if (els.email) els.email.focus();
      });
    }

    if (els.passwordToggle) {
      els.passwordToggle.addEventListener('click', function () {
        var showing = els.password.type === 'text';
        els.password.type = showing ? 'password' : 'text';
        els.passwordToggle.textContent = showing ? 'Show' : 'Hide';
        els.passwordToggle.setAttribute('aria-pressed', showing ? 'false' : 'true');
        els.password.focus();
      });
    }

    if (els.email) {
      els.email.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && els.mode === 'reset') {
          e.preventDefault();
          els.form.requestSubmit ? els.form.requestSubmit() : els.form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      });
    }

    if (els.oauthSection) {
      Array.prototype.forEach.call(els.oauthSection.querySelectorAll('[data-provider]'), function (btn) {
        btn.addEventListener('click', function () {
          signInWithProvider(btn.getAttribute('data-provider'));
        });
      });
    }

    if (els.form) {
      els.form.addEventListener('submit', onSubmit);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!client) {
      showError('Auth is still loading. Please try again in a second.');
      return;
    }
    clearMessages();
    var email = (els.email && els.email.value || '').trim();
    var password = els.password ? els.password.value : '';

    if (els.mode === 'reset') {
      if (!email) { showError('Please enter your email address.'); return; }
      setLoading(els.submit, true, 'Sending...');
      client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() }).then(function (result) {
        setLoading(els.submit, false);
        if (result.error) { showError(friendlyError(result.error.message)); return; }
        showSuccess('If an account exists for ' + email + ', a reset link is on its way.');
        els.submit.disabled = true;
      });
      return;
    }

    if (els.mode === 'newpassword') {
      if (!password) { showError('Please enter a new password.'); return; }
      if (password.length < 6) { showError('Password must be at least 6 characters.'); return; }
      setLoading(els.submit, true, 'Updating...');
      client.auth.updateUser({ password: password }).then(function (result) {
        setLoading(els.submit, false);
        if (result.error) { showError(friendlyError(result.error.message)); return; }
        if (els.password) els.password.value = '';
        showSuccess('Password updated. You are now signed in.');
        els.submit.disabled = true;
        setTimeout(closeModal, 1200);
      });
      return;
    }

    if (!email) { showError('Please enter your email address.'); return; }
    if (!password) { showError('Please enter your password.'); return; }
    if (els.mode === 'signup' && password.length < 6) { showError('Password must be at least 6 characters.'); return; }

    var isSignUp = els.mode === 'signup';
    setLoading(els.submit, true, isSignUp ? 'Creating...' : 'Signing in...');

    var request = isSignUp
      ? client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: redirectUrl() } })
      : client.auth.signInWithPassword({ email: email, password: password });

    request.then(function (result) {
      if (result.error) {
        setLoading(els.submit, false);
        showError(friendlyError(result.error.message));
        return;
      }
      if (isSignUp) {
        var needsConfirm = !result.data || !result.data.session;
        setLoading(els.submit, false);
        if (needsConfirm) {
          showSuccess('Account created. Check ' + email + ' for a confirmation link.');
        } else {
          handleSignedIn(result.data.session);
        }
        return;
      }
      if (result.data && result.data.session) {
        handleSignedIn(result.data.session);
      } else {
        setLoading(els.submit, false);
        showError('Could not sign in. Please try again.');
      }
    }).catch(function () {
      setLoading(els.submit, false);
      showError('Something went wrong. Please try again.');
    });
  }

  function handleSignedIn(session) {
    setLoading(els.submit, false);
    if (els.password) els.password.value = '';
    currentSession = session;
    currentUser = session ? session.user : null;
    renderHeader();
    updateGuestNote();
    closeModal();
    var toast = $('toast');
    if (toast) {
      toast.textContent = 'Signed in';
      toast.classList.add('show');
      setTimeout(function () { toast.classList.remove('show'); }, 1600);
    }
    if (pendingAfterAuth) {
      var fn = pendingAfterAuth;
      pendingAfterAuth = null;
      setTimeout(fn, 0);
    }
  }

  var pendingAfterAuth = null;

  /* -------------------------------- fetch ---------------------------------- */

  function installFetch() {
    if (!window.fetch || window.fetch.__readyadAuth) return;
    var originalFetch = window.fetch.bind(window);

    var patched = function (input, init) {
      var url = '';
      if (typeof input === 'string') url = input;
      else if (input && input.url) url = input.url;

      var isGenerate = /\/api\/generate$/.test(url.split('?')[0]);
      if (!isGenerate) return originalFetch(input, init);

      var token = currentSession && currentSession.access_token;
      var headers = new Headers((init && init.headers) || {});
      if (token) {
        headers.set('Authorization', 'Bearer ' + token);
      }
      headers.set('X-ReadyAd-Guest', token ? '0' : String(getGuestCount()));

      var nextInit = {};
      for (var k in (init || {})) {
        if (Object.prototype.hasOwnProperty.call(init, k)) nextInit[k] = init[k];
      }
      nextInit.headers = headers;

      return originalFetch(input, nextInit).then(function (response) {
        try {
          var isGuest = !token;
          if (isGuest && response.ok) {
            incrementGuest();
          }
          if (response.status === 401 || response.status === 403) {
            response.clone().json().then(function (data) {
              if (data && data.code === 'SIGN_IN_REQUIRED') {
                openModal('signin');
              } else if (data && data.code === 'GUEST_LIMIT') {
                openModal('signin');
                if (data && data.error) {
                  var toastEl = $('toast');
                  if (toastEl) {
                    toastEl.textContent = data.error;
                    toastEl.classList.add('show');
                    setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
                  }
                }
              }
            }).catch(function () {});
          }
        } catch (e) {}
        return response;
      });
    };
    patched.__readyadAuth = true;
    window.fetch = patched;
  }

  /* -------------------------------- init ----------------------------------- */

  function applySession(session) {
    currentSession = session || null;
    currentUser = session ? session.user : null;
    renderHeader();
    updateGuestNote();
    if (currentUser) {
      els.modal && els.modal.classList.add('hidden');
      document.body.classList.remove('auth-modal-open');
    }
  }

  function clearOAuthMarker() {
    try { sessionStorage.removeItem(OAUTH_PROVIDER_KEY); } catch (e) {}
    try {
      if (window.location.hash && (window.location.hash.indexOf('access_token') !== -1 || window.location.hash.indexOf('error') !== -1)) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch (e) {}
  }

  function init() {
    cacheEls();
    if (!els.modal) return;
    bindEvents();
    renderHeader();
    updateGuestNote();
    installFetch();

    ready.then(function (c) {
      client = c;
      initialized = true;
      clearOAuthMarker();

      client.auth.getSession().then(function (result) {
        applySession(result && result.data ? result.data.session : null);
      });

      client.auth.onAuthStateChange(function (event, session) {
        if (event === 'SIGNED_OUT') {
          applySession(null);
          return;
        }
        if (session) {
          applySession(session);
          if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            if (event === 'SIGNED_IN') {
              setLoading(els.submit, false);
              var pw = els.password;
              if (pw) pw.value = '';
              closeModal();
              var toast = $('toast');
              if (toast) {
                toast.textContent = 'Signed in';
                toast.classList.add('show');
                setTimeout(function () { toast.classList.remove('show'); }, 1600);
              }
              if (pendingAfterAuth) {
                var fn = pendingAfterAuth;
                pendingAfterAuth = null;
                setTimeout(fn, 0);
              }
            }
          }
        } else {
          applySession(null);
        }
        if (event === 'PASSWORD_RECOVERY') {
          openModal('newpassword');
        }
      });
    }).catch(function () {
      showError('Could not load sign-in. Check your connection and refresh.');
    });
  }

  window.ReadyAdAuth = {
    openModal: function (mode) { openModal(mode || 'signin'); },
    closeModal: closeModal,
    isSignedIn: function () { return !!currentUser; },
    getUser: function () { return currentUser; },
    getSession: function () { return currentSession; },
    getClient: function () { return client; },
    getGuestCount: getGuestCount,
    getFreeLimit: function () { return FREE_LIMIT; },
    getRemaining: function () { return Math.max(0, FREE_LIMIT - getGuestCount()); },
    isReady: function () { return initialized; },
    refresh: function () {
      if (!client) return;
      client.auth.getSession().then(function (result) {
        applySession(result && result.data ? result.data.session : null);
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();