// recwalk — a stepped, nested "watch the code execute" widget for the recursion lessons.
// No build step, no deps. Injects its own <style> once.
//
// Usage in a lesson:
//   <div data-recwalk="demo1"></div>
//   <script src="../assets/recwalk.js"></script>
//   <script>
//     mountRecwalk(document.querySelector('[data-recwalk="demo1"]'), STEPS);
//   </script>
//
// STEPS is an array. Each step:
//   { cap: "<html caption>", frames: [ frame, frame, ... ] }   // frames: outermost first
// A frame:
//   { title: "copy r(2)  ·  n = 2", paused: false, callAfter: 2,
//     lines: [ { t: "<code html>", c: "comment html or ''", s: "now|frozen|dim|''" }, ... ] }
// frames[i+1] is drawn nested after frames[i]'s line at index `callAfter`.

(function () {
  var CSS = [
    '.rw{border:1px solid var(--border);margin:1.4rem 0}',
    '.rw-code{padding:1rem 1.1rem;font-family:var(--mono);font-size:.82rem;line-height:1.7;overflow-x:auto;min-height:12rem}',
    '.rw-empty{color:var(--ink-soft);font-style:italic}',
    '.rw-f{border:1px solid var(--ink-soft);padding:.4rem .55rem;margin:.3rem 0}',
    '.rw-f.paused{border-style:dashed;background:var(--bg-well)}',
    '.rw-fh{font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-bottom:.3rem}',
    '.rw-fh .rw-badge{color:var(--red-ink)}',
    '.rw-child{margin:.3rem 0 .3rem .9rem;border-left:2px solid var(--border);padding-left:.7rem}',
    '.rw-l{white-space:pre;display:block;padding:.06rem .25rem}',
    '.rw-l .v{color:var(--red-ink);font-weight:700}',
    '.rw-l .rw-c{color:var(--ink-soft)}',
    '.rw-l.now{background:var(--cyan-well)}',
    '.rw-l.frozen{box-shadow:inset 2px 0 0 var(--red-ink)}',
    '.rw-l.dim{color:var(--ink-soft)}',
    '.rw-l.dim .v{color:var(--ink-soft)}',
    '.rw-cap{padding:.75rem 1.1rem;border-top:1px solid var(--border);font-size:.92rem;min-height:3.6rem}',
    '.rw-cap .out{font-family:var(--mono);color:var(--cyan-ink)}',
    '.rw-bar{display:flex;gap:.6rem;align-items:center;padding:.6rem 1.1rem;border-top:1px solid var(--border)}',
    '.rw-bar button{font-family:var(--serif);font-size:.9rem;padding:.25rem .9rem;border:1px solid var(--ink-soft);background:transparent;color:var(--ink);cursor:pointer}',
    '.rw-bar button:disabled{opacity:.35;cursor:default}',
    '.rw-bar .rw-count{font-family:var(--mono);font-size:.76rem;color:var(--ink-soft);margin-left:auto}'
  ].join('');

  if (!document.getElementById('recwalk-css')) {
    var st = document.createElement('style');
    st.id = 'recwalk-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function frameHTML(frames, i) {
    var f = frames[i];
    var child = (i + 1 < frames.length) ? frameHTML(frames, i + 1) : '';
    var ca = (f.callAfter == null) ? -1 : f.callAfter;
    var body = '';
    for (var li = 0; li < f.lines.length; li++) {
      var ln = f.lines[li];
      var cls = 'rw-l' + (ln.s ? (' ' + ln.s) : '');
      body += '<span class="' + cls + '">' + ln.t +
        (ln.c ? ('   <span class="rw-c">// ' + ln.c + '</span>') : '') + '</span>';
      if (li === ca && child) body += '<div class="rw-child">' + child + '</div>';
    }
    return '<div class="rw-f' + (f.paused ? ' paused' : '') + '">' +
      '<div class="rw-fh">' + f.title + (f.paused ? ' <span class="rw-badge">paused</span>' : '') + '</div>' +
      body + '</div>';
  }

  window.mountRecwalk = function (el, steps) {
    if (!el || !steps || !steps.length) return;
    el.classList.add('rw');
    el.innerHTML =
      '<div class="rw-code"></div><div class="rw-cap"></div>' +
      '<div class="rw-bar">' +
      '<button data-p>← Back</button>' +
      '<button data-n>Next →</button>' +
      '<button data-r>Reset</button>' +
      '<span class="rw-count"></span></div>';
    var codeEl = el.querySelector('.rw-code');
    var capEl = el.querySelector('.rw-cap');
    var countEl = el.querySelector('.rw-count');
    var bp = el.querySelector('[data-p]');
    var bn = el.querySelector('[data-n]');
    var br = el.querySelector('[data-r]');
    var i = 0;
    function render() {
      var s = steps[i];
      codeEl.innerHTML = (!s.frames || !s.frames.length)
        ? '<div class="rw-empty">(no copies running)</div>'
        : frameHTML(s.frames, 0);
      capEl.innerHTML = s.cap;
      countEl.textContent = 'step ' + i + ' / ' + (steps.length - 1);
      bp.disabled = i === 0;
      bn.disabled = i === steps.length - 1;
    }
    bp.onclick = function () { if (i > 0) { i--; render(); } };
    bn.onclick = function () { if (i < steps.length - 1) { i++; render(); } };
    br.onclick = function () { i = 0; render(); };
    render();
  };
})();
