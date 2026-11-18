/*
 * ReadyAd Supabase config
 * Loads supabase-js from the CDN and exposes ONE shared client.
 * Everything else (auth.js) waits on ReadyAdSupabase.ready.
 */
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://gsenoghfhtvytzgnqpul.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_mjX-k9xk78bS2BhWH8QOqw_8F7O4lbM';
  var CDN_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

  if (global.ReadyAdSupabase && global.ReadyAdSupabase.client) {
    return;
  }

  var client = null;

  function createClient() {
    if (client) return client;
    if (!global.supabase || typeof global.supabase.createClient !== 'function') {
      throw new Error('Supabase JS failed to load');
    }
    client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'readyad-auth'
      }
    });
    return client;
  }

  function loadScript() {
    return new Promise(function (resolve, reject) {
      if (global.supabase && typeof global.supabase.createClient === 'function') {
        resolve();
        return;
      }
      var existing = document.getElementById('supabase-js-cdn');
      if (existing) {
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () {
          reject(new Error('Could not load Supabase from CDN'));
        });
        return;
      }
      var s = document.createElement('script');
      s.id = 'supabase-js-cdn';
      s.src = CDN_URL;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        reject(new Error('Could not load Supabase from CDN'));
      };
      document.head.appendChild(s);
    });
  }

  var ready = loadScript().then(function () {
    return createClient();
  });

  global.ReadyAdSupabase = {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    ready: ready,
    getClient: function () { return client; }
  };
})(window);