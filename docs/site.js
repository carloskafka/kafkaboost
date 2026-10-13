/* KafkaBoost site script: the mobile menu and the optional GitHub release lookup on the Download page. No dependencies. */
(function () {
  'use strict';

  var btn = document.getElementById('menu-btn');
  var nav = document.getElementById('site-nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  }

  // Download page: ask GitHub for the latest release. The page already works without this
  // (a plain link to /releases/latest), so any failure just leaves the static text in place.
  var box = document.getElementById('release-box');
  if (!box || !window.fetch) return;
  var repo = box.getAttribute('data-repo');
  var msg = box.querySelector('[data-role="message"]');
  var list = box.querySelector('[data-role="assets"]');
  function say(state, text) { box.setAttribute('data-state', state); if (msg) msg.textContent = text; }
  function size(bytes) { return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

  fetch('https://api.github.com/repos/' + repo + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) {
      if (r.status === 404) { say('none', box.getAttribute('data-none')); return null; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (rel) {
      if (!rel) return;
      var assets = (rel.assets || []).filter(function (a) { return /\.(exe|msi|zip|dmg|AppImage|deb)$/i.test(a.name); });
      if (!assets.length) { say('none', box.getAttribute('data-none')); return; }
      say('found', box.getAttribute('data-found').replace('{tag}', rel.tag_name));
      assets.forEach(function (a) {
        var li = document.createElement('li');
        var link = document.createElement('a');
        link.href = a.browser_download_url;
        link.textContent = a.name;
        li.appendChild(link);
        li.appendChild(document.createTextNode(' (' + size(a.size) + ')'));
        list.appendChild(li);
      });
    })
    .catch(function () { say('error', box.getAttribute('data-error')); });
})();
