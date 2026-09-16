/*
  STEPPER — an animated, line-by-line pointer visualiser.

  Added 2026-08-27 at the learner's request; made animated the same day after
  the static version failed its actual purpose:

    "If it is static, every time I click next, I need to scan the whole block
     again."

  That is the whole design constraint. A redraw that replaces everything forces
  a full re-read on every click, which costs more working memory than tracing
  by hand did. So this component NEVER rebuilds the picture. Every box is
  keyed and persists across steps:

    - a pointer box keyed by name SLIDES from above its old target to above
      its new one, so "head moved" is seen as motion, not inferred by diffing
      two pictures;
    - a node box keyed by address stays exactly where it is;
    - only cells whose value actually changed flash;
    - boxes that appear fade in, boxes that die fade out.

  The eye follows one moving thing. Nothing else asks to be re-read.

  ------------------------------------------------------------------
  AUTHORING CONTRACT
  ------------------------------------------------------------------
  <div class="stepper" data-stepper>
    <script type="application/json">
    {
      "code": ["Node *tmp = new Node(50);", "tmp->next = head;", "head = tmp;"],
      "stages": [
        {
          "line": -1,                       // -1 = nothing executed yet
          "caption": "Before any line runs.",
          "ptrs":  [ {"name":"head","addr":"0x900","val":"0x500"} ],
          "nodes": [ {"addr":"0x500","item":"10","next":"0x520"},
                     {"addr":"0x520","item":"20","next":"NULL"} ]
        },
        { "line": 0, "caption": "...", "ptrs": [...], "nodes": [...] }
      ]
    }
    </script>
  </div>

  Each stage is a COMPLETE snapshot — list every pointer and every node that
  exists at that moment. The component diffs consecutive stages itself, so the
  author never marks a change by hand.

  Keys are "name" for pointers and "addr" for nodes. Keep them stable: reusing
  a freed address for a different node would make one box appear to mutate into
  another, which is exactly the wrong story.

  Optional keys: "note" (free text in the memory table). A node no pointer can
  reach is dimmed and flagged "unreachable" automatically.
*/
(function () {
  var ARROW =
    '<svg viewBox="0 0 32 12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<line x1="2" y1="6" x2="30" y2="6" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M23 1L30 6L23 11" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';

  var MOVE_MS = 630;
  var FLIGHT_MS = 1020;
  /* The beat. Nothing happens here, and that is the teaching: the value has
     landed and has not yet had consequences. Without this pause the flight is
     slow but the payoff is instantaneous, which is why a 1020ms flight still
     read as "too fast" — speed is perceived at the moment that matters. */
  var BEAT_MS = 440;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Set while measuring every stage to find the tallest one. During a measure
     pass nothing may animate, flash, or schedule a timer — we are rendering
     stages the learner never sees, purely to reserve height. */
  var silent = false;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function setText(node, value) {
    // Returns true if the text actually changed — the caller uses this to flash.
    if (node.textContent === value) return false;
    node.textContent = value;
    return true;
  }

  function flash(node) {
    if (!node || reduceMotion || silent) return;
    node.classList.remove("flash");
    void node.offsetWidth; // restart the animation
    node.classList.add("flash");
  }

  /* Which node addresses can be reached by following arrows from any pointer. */
  function reachable(stage) {
    var byAddr = {};
    (stage.nodes || []).forEach(function (n) { byAddr[n.addr] = n; });
    var seen = {};
    (stage.ptrs || []).forEach(function (p) {
      var a = p.val;
      while (a && a !== "NULL" && byAddr[a] && !seen[a]) {
        seen[a] = true;
        a = byAddr[a].next;
      }
    });
    return seen;
  }

  function build(root) {
    var src = root.querySelector('script[type="application/json"]');
    if (!src) return;
    var spec;
    try { spec = JSON.parse(src.textContent); }
    catch (e) {
      root.appendChild(el("div", "stepper-caption", "This stepper failed to load. Tell your tutor."));
      return;
    }
    var stages = spec.stages || [];
    if (!stages.length) return;

    /* ---------------- chrome ---------------- */
    var codeEl = el("div", "stepper-code",
      (spec.code || []).map(function (l, i) {
        return '<span class="ln" data-ln="' + i + '">' +
          String(l).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
          "</span>";
      }).join(""));

    var capEl = el("div", "stepper-caption");
    var memEl = el("div", "stepper-mem");
    var memBody = el("tbody");
    var memTable = el("table", null,
      "<thead><tr><th>box</th><th>lives at</th><th>holds</th><th></th></tr></thead>");
    memTable.appendChild(memBody);
    memEl.appendChild(memTable);

    var vizEl = el("div", "stepper-viz");

    var bar = el("div", "stepper-bar");
    var prev = el("button", null, "&larr; back"); prev.type = "button";
    var next = el("button", null, "run next line &rarr;"); next.type = "button";
    var again = el("button", null, "replay this line"); again.type = "button";
    var reset = el("button", null, "restart"); reset.type = "button";
    var countEl = el("span", "step-count");
    bar.appendChild(prev); bar.appendChild(next);
    bar.appendChild(again); bar.appendChild(reset); bar.appendChild(countEl);

    root.appendChild(codeEl);
    root.appendChild(capEl);
    root.appendChild(memEl);
    root.appendChild(vizEl);
    root.appendChild(bar);

    /* ---------------- persistent, keyed elements ---------------- */
    var cols = {};   // node addr  -> column element
    var nodes = {};  // node addr  -> {item, next, box}
    var ptrs = {};   // ptr name   -> {val, box}
    var arrows = {}; // node addr  -> arrow element that follows that column
    var memRows = {}; // key       -> <tr>
    var orphanCol = null;

    var at = 0;
    var busy = false;

    /* --- element factories --- */
    function makePtr(p) {
      var box = el("div", "node ptr-box");
      box.appendChild(el("div", "addr", p.addr || ""));
      var cell = el("div", "cell");
      var val = el("span", "next"); val.textContent = p.val;
      cell.appendChild(val);
      box.appendChild(cell);
      box.appendChild(el("div", "addr name", p.name));
      box._val = val;
      return box;
    }

    function makeNode(n) {
      var box = el("div", "node");
      box.appendChild(el("div", "addr", n.addr));
      var cell = el("div", "cell");
      var item = el("span", "item"); item.textContent = n.item;
      var nxt = el("span", n.next === "NULL" ? "next null" : "next"); nxt.textContent = n.next;
      cell.appendChild(item); cell.appendChild(nxt);
      box.appendChild(cell);
      var tag = el("div", "addr tag"); tag.textContent = "";
      box.appendChild(tag);
      box._item = item; box._next = nxt; box._tag = tag;
      return box;
    }

    function makeCol(addr) {
      var col = el("div", "stepper-col");
      col.dataset.addr = addr;
      var slot = el("div", "stepper-ptrs");
      var down = el("div", "stepper-down hidden", "&darr;");
      col.appendChild(slot);
      col.appendChild(down);
      col._slot = slot;
      col._down = down;
      return col;
    }

    /* --- FLIP: remember where everything is, then animate to where it lands --- */
    function tracked() {
      var list = [];
      Object.keys(ptrs).forEach(function (k) { list.push(ptrs[k].box); });
      Object.keys(cols).forEach(function (k) { list.push(cols[k]); });
      return list;
    }

    function firstRects() {
      var m = new Map();
      tracked().forEach(function (n) { m.set(n, n.getBoundingClientRect()); });
      return m;
    }

    function playFlip(before) {
      if (reduceMotion || silent) return;
      var moved = [];
      tracked().forEach(function (n) {
        var b = before.get(n);
        if (!b) return;
        var a = n.getBoundingClientRect();
        var dx = b.left - a.left, dy = b.top - a.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        n.style.transition = "none";
        n.style.transform = "translate(" + dx + "px," + dy + "px)";
        moved.push(n);
      });
      if (!moved.length) return;
      void vizEl.offsetWidth;
      moved.forEach(function (n) {
        n.classList.add("moving");
        n.style.transition = "transform " + MOVE_MS + "ms cubic-bezier(.16,1,.3,1)";
        n.style.transform = "";
      });
      setTimeout(function () {
        moved.forEach(function (n) {
          n.style.transition = "";
          n.classList.remove("moving");
        });
      }, MOVE_MS + 30);
    }

    /* ---------------- the diagram ---------------- */
    function renderViz(stage) {
      var before = firstRects();
      var live = reachable(stage);
      var wantNodes = stage.nodes || [];
      var wantPtrs = stage.ptrs || [];
      var byAddr = {};
      wantNodes.forEach(function (n) { byAddr[n.addr] = n; });

      /* 1. retire nodes that no longer exist */
      Object.keys(cols).forEach(function (addr) {
        if (byAddr[addr]) return;
        var col = cols[addr];
        if (silent) {
          if (col.parentNode) col.parentNode.removeChild(col);
        } else {
          col.classList.add("leaving");
          setTimeout(function () { if (col.parentNode) col.parentNode.removeChild(col); }, 390);
        }
        delete cols[addr];
        delete nodes[addr];
        if (arrows[addr]) {
          var a = arrows[addr];
          if (a.parentNode) a.parentNode.removeChild(a);
          delete arrows[addr];
        }
      });

      /* 2. create or update each node box */
      wantNodes.forEach(function (n) {
        var col = cols[n.addr];
        if (!col) {
          col = makeCol(n.addr);
          var box = makeNode(n);
          col.appendChild(box);
          col._box = box;
          cols[n.addr] = col;
          nodes[n.addr] = box;
          vizEl.appendChild(col);
          if (!silent) {
            box.classList.add("entering");
            setTimeout(function () { box.classList.remove("entering"); }, 20);
          }
        } else {
          var b = col._box;
          if (setText(b._item, n.item)) flash(b._item);
          if (setText(b._next, n.next)) flash(b._next);
          b._next.className = n.next === "NULL" ? "next null" : "next";
        }
        var bx = cols[n.addr]._box;
        bx.classList.toggle("unreachable", !live[n.addr]);
        setText(bx._tag, live[n.addr] ? "" : "unreachable");
      });

      /* 3. retire pointers that no longer exist */
      Object.keys(ptrs).forEach(function (name) {
        var still = wantPtrs.some(function (p) { return p.name === name; });
        if (still) return;
        var box = ptrs[name].box;
        if (box.parentNode) box.parentNode.removeChild(box);
        delete ptrs[name];
      });

      /* 4. the orphan column, for pointers aimed at nothing drawn */
      var needOrphan = wantPtrs.some(function (p) { return !byAddr[p.val]; });
      if (needOrphan && !orphanCol) {
        orphanCol = makeCol("__orphan");
        orphanCol.classList.add("stepper-orphan");
        vizEl.appendChild(orphanCol);
      }

      /* 5. put every node column in the right order, arrows between them */
      var order = [];
      wantNodes.forEach(function (n, i) {
        var col = cols[n.addr];
        order.push(col);
        var nxt = wantNodes[i + 1];
        var arrow = arrows[n.addr];
        var selfLoop = n.next === n.addr;
        var wantArrow = selfLoop ? "self" : nxt ? (n.next === nxt.addr ? "on" : "faint") : null;
        if (!wantArrow) {
          if (arrow) { if (arrow.parentNode) arrow.parentNode.removeChild(arrow); delete arrows[n.addr]; }
          return;
        }
        if (!arrow) {
          arrow = el("div", "arrow");
          arrows[n.addr] = arrow;
        }
        if (wantArrow === "self") {
          arrow.className = "arrow self";
          arrow.textContent = "↺";
          arrow.title = "next points back at this same node";
        } else {
          arrow.className = "arrow" + (wantArrow === "faint" ? " faint" : "");
          arrow.innerHTML = ARROW;
          arrow.title = "";
        }
        order.push(arrow);
      });
      if (orphanCol) {
        if (needOrphan) order.push(orphanCol);
        else { if (orphanCol.parentNode) orphanCol.parentNode.removeChild(orphanCol); orphanCol = null; }
      }
      order.forEach(function (node) { vizEl.appendChild(node); });

      /* 6. move each pointer box into the column above its target */
      wantPtrs.forEach(function (p) {
        var rec = ptrs[p.name];
        if (!rec) {
          var box = makePtr(p);
          rec = ptrs[p.name] = { val: null, box: box };
          if (!silent) {
            box.classList.add("entering");
            setTimeout(function () { box.classList.remove("entering"); }, 20);
          }
        }
        if (rec.val !== p.val) {
          if (rec.val !== null && setText(rec.box._val, p.val)) flash(rec.box._val);
          else rec.box._val.textContent = p.val;
          rec.val = p.val;
        }
        var home = byAddr[p.val] ? cols[p.val] : orphanCol;
        if (home && rec.box.parentNode !== home._slot) home._slot.appendChild(rec.box);
      });

      /* 7. show the down-arrow only on columns that actually have a pointer */
      Object.keys(cols).forEach(function (a) {
        cols[a]._down.classList.toggle("hidden", !cols[a]._slot.children.length);
      });
      if (orphanCol) orphanCol._down.classList.add("hidden");

      playFlip(before);
    }

    /* ---------------- the memory table ---------------- */
    function renderMem(stage, prevStage) {
      var live = reachable(stage);
      var prevPtr = {}, prevNode = {};
      if (prevStage) {
        (prevStage.ptrs || []).forEach(function (p) { prevPtr[p.name] = p.val; });
        (prevStage.nodes || []).forEach(function (n) { prevNode[n.addr] = n.item + "|" + n.next; });
      }

      var wanted = [];
      (stage.ptrs || []).forEach(function (p) {
        wanted.push({
          key: "p:" + p.name,
          name: p.name,
          addr: p.addr || "",
          holds: p.val,
          changed: prevStage && prevPtr.hasOwnProperty(p.name) && prevPtr[p.name] !== p.val,
          fresh: prevStage && !prevPtr.hasOwnProperty(p.name),
          lost: false,
          note: p.note
        });
      });
      (stage.nodes || []).forEach(function (n) {
        var key = n.item + "|" + n.next;
        wanted.push({
          key: "n:" + n.addr,
          name: "node",
          addr: n.addr,
          holds: "item " + n.item + "  ·  next " + n.next,
          changed: prevStage && prevNode.hasOwnProperty(n.addr) && prevNode[n.addr] !== key,
          fresh: prevStage && !prevNode.hasOwnProperty(n.addr),
          lost: !live[n.addr],
          note: n.note
        });
      });

      var seen = {};
      wanted.forEach(function (w) {
        seen[w.key] = true;
        var tr = memRows[w.key];
        if (!tr) {
          tr = el("tr");
          tr.appendChild(el("td", "name"));
          tr.appendChild(el("td"));
          tr.appendChild(el("td"));
          tr.appendChild(el("td", null, '<span class="tag"></span>'));
          memRows[w.key] = tr;
        }
        tr.children[0].textContent = w.name;
        tr.children[1].textContent = w.addr;
        if (setText(tr.children[2], w.holds) && (w.changed || w.fresh)) flash(tr.children[2]);
        tr.children[3].firstChild.textContent =
          w.note ? w.note
            : w.lost ? "unreachable"
            : w.fresh ? "just created"
            : w.changed ? "changed this line" : "";
        tr.className = w.lost ? "lost" : (w.changed || w.fresh) ? "changed" : "";
        memBody.appendChild(tr);
      });
      Object.keys(memRows).forEach(function (k) {
        if (seen[k]) return;
        var tr = memRows[k];
        if (tr.parentNode) tr.parentNode.removeChild(tr);
        delete memRows[k];
      });
    }

    /* ---------------- the copy flight ----------------
       The focal moment of the whole component.

       An assignment copies a value OUT of one box and INTO another. The old
       version only flashed the destination, which showed the effect and hid
       the cause — and the cause is the entire lesson: in the broken insert,
       `head` has already been overwritten by the time its value is read.

       So the value physically leaves the source, arcs across, and lands. The
       source keeps its value throughout, because a copy is not a move. And
       nothing else moves until the value has landed: the pointer only slides
       to its new target afterwards, in that order, because that is the order
       the machine does it in.

       Declared per stage:  "copy": { "from": "ptr:head", "to": "node:0x560.next" }
       Addresses: ptr:<name> · node:<addr>.item · node:<addr>.next             */

    function resolveCell(sel) {
      if (!sel) return null;
      var m = /^ptr:(.+)$/.exec(sel);
      if (m) return ptrs[m[1]] ? ptrs[m[1]].box._val : null;
      m = /^node:([^.]+)\.(item|next)$/.exec(sel);
      if (m) {
        var col = cols[m[1]];
        if (!col || !col._box) return null;
        return m[2] === "item" ? col._box._item : col._box._next;
      }
      return null;
    }

    /* The stage as it stands the instant BEFORE the value lands: everything
       the line created already exists, but the destination still holds its old
       value and every pointer still sits where it sat. */
    function beforeLanding(stage, prevStage) {
      var c = stage.copy;
      var prevPtr = {}, prevNode = {};
      (prevStage.ptrs || []).forEach(function (p) { prevPtr[p.name] = p; });
      (prevStage.nodes || []).forEach(function (n) { prevNode[n.addr] = n; });
      var out = { line: stage.line, caption: stage.caption, ptrs: [], nodes: [] };
      (stage.ptrs || []).forEach(function (p) {
        var q = { name: p.name, addr: p.addr, val: p.val, note: p.note };
        if (c.to === "ptr:" + p.name && prevPtr[p.name]) q.val = prevPtr[p.name].val;
        out.ptrs.push(q);
      });
      (stage.nodes || []).forEach(function (n) {
        var q = { addr: n.addr, item: n.item, next: n.next, note: n.note };
        var pn = prevNode[n.addr];
        if (pn) {
          if (c.to === "node:" + n.addr + ".next") q.next = pn.next;
          if (c.to === "node:" + n.addr + ".item") q.item = pn.item;
        }
        out.nodes.push(q);
      });
      return out;
    }

    function fly(src, dst, done) {
      if (!src || !dst || !src.animate) { done(); return; }
      var a = src.getBoundingClientRect();
      var b = dst.getBoundingClientRect();
      var ghost = el("span", "stepper-ghost");
      ghost.textContent = src.textContent;
      ghost.style.left = a.left + "px";
      ghost.style.top = a.top + "px";
      ghost.style.width = a.width + "px";
      ghost.style.height = a.height + "px";
      ghost.style.lineHeight = a.height + "px";
      document.body.appendChild(ghost);

      src.classList.add("copy-src");
      dst.classList.add("copy-dst");

      var dx = b.left - a.left + (b.width - a.width) / 2;
      var dy = b.top - a.top;
      var lift = Math.min(44, 16 + Math.abs(dx) * 0.07);

      var anim = ghost.animate(
        [
          { transform: "translate(0,0) scale(1)", opacity: 0.0, offset: 0 },
          { transform: "translate(0,0) scale(1.14)", opacity: 1, offset: 0.14 },
          { transform: "translate(" + dx / 2 + "px," + (dy / 2 - lift) + "px) scale(1.08)", opacity: 1, offset: 0.6 },
          { transform: "translate(" + dx + "px," + dy + "px) scale(1)", opacity: 1, offset: 1 }
        ],
        { duration: FLIGHT_MS, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }
      );

      var settled = false;
      function land() {
        if (settled) return;
        settled = true;
        // The ghost stays put, sitting exactly on the destination cell, for as
        // long as the beat lasts. The value is visibly *in* the box before
        // anything is allowed to react to it.
        done(function clear() {
          if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
          src.classList.remove("copy-src");
          dst.classList.remove("copy-dst");
        });
      }
      anim.onfinish = land;
      setTimeout(land, FLIGHT_MS + 280); // if onfinish never fires
    }

    /* ---------------- driver ---------------- */
    function drawStage(stage, prevStage) {
      // Clear last line's marks first. One line, one set of marks — a settled
      // picture must never carry a highlight from a step already past.
      root.querySelectorAll(".flash").forEach(function (n) { n.classList.remove("flash"); });
      codeEl.querySelectorAll(".ln").forEach(function (ln) {
        var i = +ln.dataset.ln;
        var isNow = i === stage.line;
        if (isNow && !ln.classList.contains("now")) flash(ln);
        ln.classList.toggle("now", isNow);
        ln.classList.toggle("done", stage.line >= 0 && i < stage.line);
      });
      capEl.innerHTML = stage.caption || "";
      renderMem(stage, prevStage);
      renderViz(stage);
      prev.disabled = at === 0;
      next.disabled = at === stages.length - 1;
      again.disabled = at === 0;
      countEl.textContent = "step " + (at + 1) + " / " + stages.length;
    }

    function draw(prevStage) { drawStage(stages[at], prevStage); }

    function go(to) {
      if (busy || to < 0 || to >= stages.length || to === at) return;
      var from = at;
      var stage = stages[to];
      // Only treat it as a diff when moving one step; a jump has no single
      // "line that changed" and flashing everything would defeat the point.
      var stepwise = Math.abs(to - from) === 1;
      var prevStage = stepwise ? stages[from] : null;
      busy = true;
      at = to;

      var copying = stepwise && stage.copy && !reduceMotion && to > from;
      if (!copying) {
        draw(prevStage);
        setTimeout(function () { busy = false; }, reduceMotion ? 0 : MOVE_MS);
        return;
      }

      // BEAT ONE — the copy, alone. Everything not involved in it is dimmed,
      // the memory table is frozen, and the destination holds its old value.
      // BEAT TWO — after a pause on the landing, the consequences.
      drawStage(beforeLanding(stage, prevStage), null);
      root.classList.add("beat-copy");
      fly(resolveCell(stage.copy.from), resolveCell(stage.copy.to), function (clear) {
        setTimeout(function () {
          clear();
          root.classList.remove("beat-copy");
          drawStage(stage, prevStage);
          setTimeout(function () { busy = false; }, MOVE_MS);
        }, BEAT_MS);
      });
    }

    /* ---------------- constant height ----------------
       The learner: "could you make the size of the box constant? currently the
       size changes and I need to move my mouse every time after run next line
       to locate the button."

       A control that moves has to be re-found on every click, which is the same
       tax the static redraw charged. So: render every stage once, invisibly,
       take the tallest, and reserve that height for good. The buttons then
       never move, and neither does anything above them. */
    function wipe() {
      vizEl.innerHTML = "";
      memBody.innerHTML = "";
      cols = {}; nodes = {}; ptrs = {}; arrows = {}; memRows = {};
      orphanCol = null;
    }

    function lockHeights() {
      var maxCap = 0, maxMem = 0, maxViz = 0;
      capEl.style.minHeight = "";
      memEl.style.minHeight = "";
      vizEl.style.minHeight = "";
      silent = true;
      wipe();
      for (var i = 0; i < stages.length; i++) {
        capEl.innerHTML = stages[i].caption || "";
        renderMem(stages[i], i > 0 ? stages[i - 1] : null);
        renderViz(stages[i]);
        if (capEl.scrollHeight > maxCap) maxCap = capEl.scrollHeight;
        if (memEl.scrollHeight > maxMem) maxMem = memEl.scrollHeight;
        if (vizEl.scrollHeight > maxViz) maxViz = vizEl.scrollHeight;
      }
      wipe();
      silent = false;
      capEl.style.minHeight = maxCap + "px";
      memEl.style.minHeight = maxMem + "px";
      vizEl.style.minHeight = maxViz + "px";
      at = 0;
      draw(null);
    }

    /* The single most important second of the lesson deserves its own control.
       Stepping back then forward does not replay it — a copy only animates
       forwards — so re-watching it had been impossible. */
    again.addEventListener("click", function () {
      if (busy || at === 0) return;
      var to = at;
      at = to - 1;
      drawStage(stages[at], null);
      setTimeout(function () { go(to); }, 90);
    });

    prev.addEventListener("click", function () { go(at - 1); });
    next.addEventListener("click", function () { go(at + 1); });
    reset.addEventListener("click", function () {
      if (at === 0 || busy) return;
      at = 0;
      draw(null);
    });

    lockHeights();

    /* Web fonts land after first layout and change every box's size, so the
       reserved height would be measured against the wrong font. Re-measure
       once they are ready — but only if the learner hasn't started stepping,
       since re-measuring returns to step 1. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (at === 0 && !busy) lockHeights();
      });
    }
    window.addEventListener("resize", function () {
      if (at === 0 && !busy) lockHeights();
    });
  }

  document.querySelectorAll("[data-stepper]").forEach(build);
})();
