    /* ============================================================
       THEME TOGGLE
    ============================================================ */
    document.getElementById('theme-toggle').addEventListener('click', function() {
      var html = document.documentElement;
      var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('tl-theme', next);
    });

    /* ============================================================
       NAV SCROLL EFFECT
    ============================================================ */
    var nav = document.getElementById('nav');
    window.addEventListener('scroll', function() {
      nav.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });

    /* ============================================================
       REDUCED MOTION DETECTION
    ============================================================ */
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ============================================================
       HERO TERMINAL — ANIMATED TYPING
    ============================================================ */
    var heroAnimations = [
      {
        cmd: 'ticketlens triage',
        delay: 1200,
        output: [
          '<span class="t-dim">Scanning myteam · In Progress, Code Review, QA...</span>',
          '',
          '<span class="t-red">●</span> <span class="t-white">PROJ-123</span>  <span class="t-muted">Implement OAuth2 login flow</span>  <span class="t-dim">In Progress</span>  <span class="t-red">↓ stale 7d</span>',
          '<span class="t-red">●</span> <span class="t-white">PROJ-119</span>  <span class="t-muted">Fix mobile nav collapse</span>       <span class="t-dim">Code Review</span>  <span class="t-red">↓ stale 5d</span>',
          '<span class="t-yellow">●</span> <span class="t-white">PROJ-124</span>  <span class="t-muted">Update API rate limits</span>         <span class="t-dim">QA</span>           <span class="t-yellow">● new comment</span>',
          '<span class="t-green">○</span> <span class="t-white">PROJ-121</span>  <span class="t-muted">Design token audit</span>             <span class="t-dim">In Progress</span>  <span class="t-green">✓ up to date</span>',
          '',
          '<span class="t-dim">4 tickets · 2 need response · 1 aging</span>',
          '<span class="t-dim">↑/↓ navigate · Enter open · q exit</span>',
        ]
      },
      {
        cmd: 'ticketlens PROJ-123',
        delay: 900,
        output: [
          '<span class="t-dim">○ PROJ-123 · from cache (12m ago)  ·  --no-cache to refresh</span>',
          '',
          '<span class="t-white t-bold">PROJ-123</span> <span class="t-dim">—</span> <span class="t-green">Implement OAuth2 Login Flow</span>',
          '<span class="t-dim">Status: </span><span class="t-yellow">In Progress</span>  <span class="t-dim">Priority: </span><span class="t-red">High</span>',
          '<span class="t-dim">Assignee: </span><span class="t-white">R. Moran</span>',
          '',
          '<span class="t-muted">OAuth2 with Google + GitHub. Token rotation required.</span>',
          '<span class="t-muted">Security audit flags resolved in PROJ-118.</span>',
          '',
          '<span class="t-dim">Linked:</span> <span class="t-white">PROJ-118</span> <span class="t-green">[Done]</span> <span class="t-dim">·</span> <span class="t-white">PROJ-124</span> <span class="t-yellow">[Active]</span>',
          '<span class="t-dim">Files: </span><span class="t-green">src/auth/oauth.ts · middleware.ts</span>',
          '<span class="t-dim">Cache: </span><span class="t-dim">~/.ticketlens/cache/myteam/PROJ-123/brief.json</span>',
        ]
      },
      {
        cmd: 'ticketlens PROJ-123 --compliance',
        delay: 1000,
        output: [
          '<span class="t-muted">Analyzing PROJ-123 requirements against local diff...</span>',
          '',
          '<span class="t-green">✓</span> <span class="t-white">OAuth2 Google login</span>  <span class="t-dim">— implemented (oauth.ts:47)</span>',
          '<span class="t-green">✓</span> <span class="t-white">OAuth2 GitHub login</span>  <span class="t-dim">— implemented (oauth.ts:89)</span>',
          '<span class="t-green">✓</span> <span class="t-white">Token rotation</span>       <span class="t-dim">— implemented (auth.service.ts:23)</span>',
          '<span class="t-red">✗</span> <span class="t-white">Security audit log</span>   <span class="t-dim">— NOT FOUND in diff</span>',
          '<span class="t-yellow">?</span> <span class="t-white">Rate limiting</span>        <span class="t-dim">— partially addressed</span>',
          '',
          '<span class="t-dim">Compliance: 3/5 requirements met</span>',
          '<span class="t-dim">Free tier: 2/3 monthly uses remaining</span>',
        ]
      }
    ];

    var heroAnim = { current: 0, typing: false, paused: false, timer: null };

    function typeCmd(cmd, el, cursor, cb) {
      var i = 0;
      el.textContent = '';
      cursor.style.display = 'inline-block';
      function tick() {
        if (heroAnim.paused) { heroAnim.timer = setTimeout(tick, 200); return; }
        if (i < cmd.length) {
          el.textContent += cmd[i++];
          heroAnim.timer = setTimeout(tick, 45 + Math.random() * 30);
        } else {
          cb();
        }
      }
      tick();
    }

    function showOutput(lines, container, cursor, delay, cb) {
      cursor.style.display = 'none';
      container.style.display = 'block';
      container.innerHTML = '';
      var i = 0;
      function next() {
        if (heroAnim.paused) { heroAnim.timer = setTimeout(next, 200); return; }
        if (i < lines.length) {
          var line = document.createElement('span');
          line.className = 'terminal-output-line';
          line.innerHTML = lines[i++];
          container.appendChild(line);
          heroAnim.timer = setTimeout(next, delay);
        } else {
          cursor.style.display = 'none';
          heroAnim.timer = setTimeout(cb, 3200);
        }
      }
      heroAnim.timer = setTimeout(next, 300);
    }

    function runHeroLoop() {
      if (reducedMotion) return;
      var anim = heroAnimations[heroAnim.current % heroAnimations.length];
      var cmdEl = document.getElementById('t-cmd');
      var cursor = document.getElementById('t-cursor');
      var output = document.getElementById('t-output');
      if (!cmdEl) return;
      output.style.display = 'none';
      output.innerHTML = '';
      typeCmd(anim.cmd, cmdEl, cursor, function() {
        showOutput(anim.output, output, cursor, anim.delay / anim.output.length, function() {
          heroAnim.current++;
          runHeroLoop();
        });
      });
    }

    // Hero terminal tabs
    document.getElementById('tab-cli').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('tab-jtb').classList.remove('active');
      document.getElementById('t-panel-cli').style.display = 'block';
      document.getElementById('t-panel-jtb').style.display = 'none';
    });
    document.getElementById('tab-jtb').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('tab-cli').classList.remove('active');
      document.getElementById('t-panel-cli').style.display = 'none';
      document.getElementById('t-panel-jtb').style.display = 'block';
    });

    if (!reducedMotion) { setTimeout(runHeroLoop, 600); }

    /* ============================================================
       FEATURES PANEL
    ============================================================ */
    var featData = [
      {
        label: 'ticketlens PROJ-123',
        lines: [
          '<span style="color:#404958">○ PROJ-123 · from cache (12m ago)  ·  --no-cache to refresh</span>',
          '',
          '<span style="color:#e1e8f4;font-weight:700">PROJ-123</span> <span style="color:#404958">—</span> <span style="color:#6366f1">Implement OAuth2 Login Flow</span>',
          '<span style="color:#404958">Status: </span><span style="color:#e3b341">In Progress</span>  <span style="color:#404958">Priority: </span><span style="color:#f85149">High</span>',
          '<span style="color:#404958">Assignee: </span><span style="color:#e1e8f4">R. Moran</span>',
          '',
          '<span style="color:#7b8aa0">OAuth2 with Google + GitHub. Token rotation required.</span>',
          '<span style="color:#7b8aa0">Security audit flags resolved in PROJ-118.</span>',
          '',
          '<span style="color:#404958">Linked: </span><span style="color:#e1e8f4">PROJ-118</span> <span style="color:#6366f1">[Done]</span> <span style="color:#404958">·</span> <span style="color:#e1e8f4">PROJ-124</span> <span style="color:#e3b341">[Active]</span>',
          '<span style="color:#404958">Files:  </span><span style="color:#6366f1">src/auth/oauth.ts · middleware.ts</span>',
          '<span style="color:#404958">Cache:  </span><span style="color:#404958">~/.ticketlens/cache/myteam/PROJ-123/</span>',
        ]
      },
      {
        label: 'ticketlens triage',
        lines: [
          '<span style="color:#404958">Scanning myteam · In Progress, Code Review, QA...</span>',
          '',
          '<span style="color:#f85149">●</span> <span style="color:#e1e8f4">PROJ-123</span>  <span style="color:#7b8aa0">Implement OAuth2 login flow</span>  <span style="color:#404958">In Progress</span>  <span style="color:#f85149">↓ stale 7d</span>',
          '<span style="color:#f85149">●</span> <span style="color:#e1e8f4">PROJ-119</span>  <span style="color:#7b8aa0">Fix mobile nav collapse</span>       <span style="color:#404958">Code Review</span>  <span style="color:#f85149">↓ stale 5d</span>',
          '<span style="color:#e3b341">●</span> <span style="color:#e1e8f4">PROJ-124</span>  <span style="color:#7b8aa0">Update API rate limits</span>         <span style="color:#404958">QA</span>           <span style="color:#e3b341">● new comment</span>',
          '<span style="color:#6366f1">○</span> <span style="color:#e1e8f4">PROJ-121</span>  <span style="color:#7b8aa0">Design token audit</span>             <span style="color:#404958">In Progress</span>  <span style="color:#6366f1">✓ ok</span>',
          '',
          '<span style="color:#404958">4 tickets · 2 need response · 1 aging</span>',
          '<span style="color:#404958">↑/↓ navigate · Enter open · q exit</span>',
        ]
      },
      {
        label: 'ticketlens PROJ-123 --check',
        lines: [
          '<span style="color:#404958">── VCS CHECK ───────────────────────────────────</span>',
          '<span style="color:#404958">Branch: </span><span style="color:#6366f1">feature/oauth2-login</span>',
          '',
          '<span style="color:#404958">Modified files:</span>',
          '<span style="color:#6366f1">  src/auth/oauth.ts</span>        <span style="color:#404958">+142 −8</span>',
          '<span style="color:#6366f1">  src/middleware.ts</span>        <span style="color:#404958">+23 −2</span>',
          '<span style="color:#6366f1">  tests/auth.test.ts</span>       <span style="color:#404958">+78 −0</span>',
          '',
          '<span style="color:#404958">── CLAUDE CODE INSTRUCTIONS ────────────────────</span>',
          '<span style="color:#7b8aa0">Compare this diff against PROJ-123 requirements.</span>',
          '<span style="color:#7b8aa0">Flag any acceptance criteria not addressed.</span>',
          '<span style="color:#7b8aa0">Note missing tests for new auth flows.</span>',
        ]
      },
      {
        label: 'ticketlens PROJ-123 --compliance',
        lines: [
          '<span style="color:#7b8aa0">Analyzing PROJ-123 against local diff...</span>',
          '',
          '<span style="color:#6366f1">✓</span> <span style="color:#e1e8f4">OAuth2 Google login</span>    <span style="color:#404958">oauth.ts:47</span>',
          '<span style="color:#6366f1">✓</span> <span style="color:#e1e8f4">OAuth2 GitHub login</span>    <span style="color:#404958">oauth.ts:89</span>',
          '<span style="color:#6366f1">✓</span> <span style="color:#e1e8f4">Token rotation</span>         <span style="color:#404958">auth.service.ts:23</span>',
          '<span style="color:#f85149">✗</span> <span style="color:#e1e8f4">Security audit logging</span> <span style="color:#404958">NOT FOUND in diff</span>',
          '<span style="color:#e3b341">?</span> <span style="color:#e1e8f4">Rate limiting</span>          <span style="color:#404958">partially addressed</span>',
          '',
          '<span style="color:#404958">Compliance: 3/5 requirements met</span>',
          '<span style="color:#404958">Free tier: 2/3 monthly uses remaining</span>',
        ]
      },
      {
        label: 'ticketlens PROJ-123 --depth=2',
        lines: [
          '<span style="color:#7b8aa0">Fetching PROJ-123 + dependency graph...</span>',
          '',
          '<span style="color:#e1e8f4;font-weight:700">PROJ-123</span> <span style="color:#e3b341">In Progress</span>  <span style="color:#7b8aa0">Implement OAuth2 login flow</span>',
          '  <span style="color:#6366f1">PROJ-118</span> <span style="color:#6366f1">[Done]</span>    <span style="color:#7b8aa0">Auth provider setup</span>',
          '    <span style="color:#404958">PROJ-115</span> <span style="color:#404958">[Done]</span>  <span style="color:#404958">OAuth2 library selection</span>',
          '    <span style="color:#404958">PROJ-116</span> <span style="color:#404958">[Done]</span>  <span style="color:#404958">Provider API registration</span>',
          '  <span style="color:#e3b341">PROJ-124</span> <span style="color:#e3b341">[Active]</span>  <span style="color:#7b8aa0">Rate limit middleware</span>',
          '    <span style="color:#404958">PROJ-126</span> <span style="color:#e3b341">[Active]</span> <span style="color:#404958">Redis integration</span>',
          '',
          '<span style="color:#404958">6 tickets fetched · 2,847 tokens total</span>',
        ]
      },
      {
        label: '/jtb PROJ-123  [Claude Code]',
        lines: [
          '<span style="color:#404958">Claude Code  ●  ~/projects/auth-service</span>',
          '',
          '<span style="color:#6366f1">❯ /jtb PROJ-123</span>',
          '',
          '<span style="color:#e3b341">⚡</span> <span style="color:#7b8aa0">TicketLens — fetching PROJ-123...</span>',
          '',
          '<span style="color:#404958">──────────────────────────────────────</span>',
          '<span style="color:#e1e8f4;font-weight:700">PROJ-123</span>  <span style="color:#6366f1">Implement OAuth2 Login Flow</span>',
          '<span style="color:#7b8aa0">OAuth2 with Google + GitHub. Token rotation required.</span>',
          '',
          '<span style="color:#6366f1">✓ 842 tokens loaded into Claude context.</span>',
          '<span style="color:#7b8aa0">Entering plan mode. What would you like to implement?</span>',
        ]
      },
    ];

    var featActive = 0;
    var featAutoTimer = null;
    var FEAT_INTERVAL = 5000;

    function renderFeatDemo(idx) {
      var data = featData[idx];
      var body = document.getElementById('feat-demo-body');
      var label = document.getElementById('feat-demo-label');
      if (!body) return;
      label.textContent = data.label;
      body.innerHTML = data.lines.map(function(l) {
        return '<span style="display:block;min-height:1.75em">' + l + '</span>';
      }).join('');
    }

    function setFeatActive(idx, resetTimer) {
      var items = document.querySelectorAll('.feat-item');
      items.forEach(function(el, i) { el.classList.toggle('active', i === idx); });
      featActive = idx;
      renderFeatDemo(idx);
      if (resetTimer) {
        clearInterval(featAutoTimer);
        if (!reducedMotion) { startFeatAuto(); }
      }
      var bar = document.getElementById('feat-progress-bar');
      if (bar && !reducedMotion) { bar.style.width = '0%'; bar.style.transition = 'none'; void bar.offsetWidth; bar.style.transition = 'width ' + FEAT_INTERVAL + 'ms linear'; bar.style.width = '100%'; }
    }

    function startFeatAuto() {
      featAutoTimer = setInterval(function() {
        setFeatActive((featActive + 1) % featData.length, false);
      }, FEAT_INTERVAL);
    }

    document.querySelectorAll('.feat-item').forEach(function(el, i) {
      el.addEventListener('click', function() { setFeatActive(i, true); });
    });

    setFeatActive(0, false);
    if (!reducedMotion) { startFeatAuto(); }

    /* ============================================================
       PAGE VISIBILITY — pause/resume all JS loops
    ============================================================ */
    document.addEventListener('visibilitychange', function() {
      var hidden = document.hidden;
      heroAnim.paused = hidden;
      if (hidden) {
        clearInterval(featAutoTimer);
        featAutoTimer = null;
      } else {
        if (!reducedMotion && featAutoTimer === null) { startFeatAuto(); }
      }
    });

    /* ============================================================
       LOGOS CAROUSEL — IntersectionObserver pause/resume
    ============================================================ */
    var logosTrack = document.getElementById('logos-track');
    if (logosTrack) {
      var logosIO = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) {
          logosTrack.classList.toggle('paused', !e.isIntersecting);
        });
      }, { threshold: 0 });
      logosIO.observe(document.querySelector('.logos-section'));
    }

    /* ============================================================
       ARCH DIAGRAM — IntersectionObserver gate animations
    ============================================================ */
    var archWrap = document.querySelector('.arch-diagram-wrap');
    if (archWrap) {
      var archIO = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) {
          e.target.classList.toggle('arch-animated', e.isIntersecting);
        });
      }, { threshold: 0.1 });
      archIO.observe(archWrap);
    }

    /* ============================================================
       HERO TERMINAL WRAP — remove will-change after animation
    ============================================================ */
    var heroWrap = document.querySelector('.hero-terminal-wrap');
    if (heroWrap) {
      heroWrap.addEventListener('animationend', function() {
        this.style.willChange = 'auto';
      }, { once: true });
    }

    /* ============================================================
       FAQ ACCORDION
    ============================================================ */
    document.querySelectorAll('.faq-q').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var item = this.closest('.faq-item');
        var isOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(function(o) {
          o.classList.remove('open');
          o.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
          item.classList.add('open');
          this.setAttribute('aria-expanded', 'true');
        }
      });
    });

    /* ============================================================
       COPY BUTTONS
    ============================================================ */
    document.querySelectorAll('.copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var text = this.getAttribute('data-copy');
        navigator.clipboard.writeText(text).then(function() {}).catch(function() {});
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
      });
    });

    /* ============================================================
       SCROLL FADE-IN
    ============================================================ */
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.fade-in').forEach(function(el) { observer.observe(el); });
