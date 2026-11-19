// UP is an interactive strategic decision and business test surface.
export function createUpView({ request: transport, getUser, getLanguage, onLogin }) {
  const pendingIdempotencyKeys = new Map();
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('helmer:logout', () => pendingIdempotencyKeys.clear());
    window.addEventListener('helmer:user-changed', () => pendingIdempotencyKeys.clear());
    window.addEventListener('helmer:auth-required', () => pendingIdempotencyKeys.clear());
  }
  const request = async (path, options = {}) => {
    const isChallengeMutation = options.method === 'POST' && /^\/api\/up\/challenges(?:\/|$)/.test(path);
    const opSignature = isChallengeMutation ? `${getUser()?.id || 'guest'}:${path}:${options.body || ''}` : null;
    const explicitKey = options.headers?.['Idempotency-Key'];
    const idempotencyKey = isChallengeMutation
      ? (explicitKey || pendingIdempotencyKeys.get(opSignature) || crypto.randomUUID())
      : null;
    if (opSignature && !explicitKey) {
      pendingIdempotencyKeys.set(opSignature, idempotencyKey);
    }
    const response = await transport(path, {
      ...options,
      ...(isChallengeMutation
        ? { headers: { 'Idempotency-Key': idempotencyKey, ...options.headers } } : {}),
    });
    if (opSignature && path === '/api/up/challenges') {
      pendingIdempotencyKeys.delete(opSignature);
    }
    return response;
  };
  const copy = (en, az) => getLanguage() === 'en' ? en : az;
  function node(tag, className = '', text = '') {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text) n.textContent = text;
    return n;
  }
  function button(text, action, secondary = false) {
    const n = node('button', secondary ? 'up-button up-secondary' : 'up-button', text);
    n.type = 'button';
    n.addEventListener('click', action);
    return n;
  }
  function progress(label, value, goal) {
    const card = node('section', 'up-card up-goal');
    const h = node('h3', '', label);
    const count = node('p', 'up-stat', `${value} / ${goal} Points`);
    const bar = node('progress');
    bar.max = goal;
    bar.value = Math.min(goal, value);
    bar.setAttribute('aria-label', `${label}: ${value} / ${goal} Points`);
    card.append(h, count, bar, node('p', 'up-muted', value >= goal ? copy('Goal complete', 'Hədəf tamamlandı') : copy(`${goal - value} Points remaining`, `${goal - value} Points qalıb`)));
    return card;
  }

  return function mount(host) {
    host.classList.add('up-workspace');
    const userId = getUser()?.id;
    const root = node('div', 'up-root');
    host.append(root);

    const valid = () => root.isConnected && getUser()?.id === userId;
    let data = null, challenge = null, error = '', busy = false, selectedOption = '', settings = false, timer = null, isGenerating = false;

    function notice(message, danger = false) {
      const n = node('p', danger ? 'up-notice up-error' : 'up-notice', message);
      n.setAttribute('role', danger ? 'alert' : 'status');
      return n;
    }

    function header() {
      const h = node('header', 'up-header'), title = node('div');
      const h1 = node('h1', 'up-title');
      h1.append(
        document.createTextNode('Helmer UP'),
        node('span', 'up-beta-chip', 'Beta')
      );
      title.append(
        node('p', 'up-eyebrow', copy('Business Thinking · Strategic Practice', 'Biznes düşüncəsi · Strateji məşq')),
        h1
      );
      h.append(title);
      if (data?.onboardingComplete) {
        h.append(button(copy('Goals & interests', 'Hədəflər və maraqlar'), () => { settings = !settings; draw(); }, true));
      }
      return h;
    }

    function pendingPoll() {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!valid()) return;
        try {
          data = await request('/api/up');
          if (!valid()) return;
          if (challenge && data.activeChallenge?.id === challenge.id) challenge = data.activeChallenge;
          else if (challenge) challenge = data.history.find(c => c.id === challenge.id) || challenge;
          draw();
        } catch (e) { if (valid()) { error = e.message; draw(); } }
      }, 4000);
    }

    async function run(action, message) {
      if (busy) return;
      busy = true;
      error = '';
      draw(message);
      try {
        await action();
      } catch (e) {
        if (valid()) {
          error = e.message;
          try {
            const refreshed = await request('/api/up');
            if (!valid()) return;
            data = refreshed;
            if (challenge?.id === data.activeChallenge?.id) challenge = data.activeChallenge;
            else if (challenge) challenge = data.history.find(c => c.id === challenge.id) || challenge;
          } catch {}
        }
      } finally {
        busy = false;
        isGenerating = false;
        if (valid()) {
          draw();
          const focus = root.querySelector('.up-earned-badge, .up-scenario-title, .up-scenario-card h2');
          if (focus) { focus.tabIndex = -1; focus.focus(); }
        }
      }
    }

    async function load(opened = false) {
      const next = await request(opened ? '/api/up/opened' : '/api/up', opened ? { method: 'POST', body: '{}' } : {});
      if (!valid()) return;
      data = next;
      draw();
    }

    function preferencesForm(firstTime) {
      const card = node('section', 'up-card up-preferences');
      card.append(
        node('h2', '', firstTime ? copy('Build your practice habit', 'Məşq hədəflərini seç') : copy('Your practice goals', 'Məşq hədəflərin')),
        node('p', 'up-muted', copy('Sharpen executive decision making through realistic high-stakes dilemmas and instant trade-off insights.', 'Real biznes dilemmaları və dərhal strateji trade-off analizləri ilə qərarverməni itiləşdir.'))
      );
      const form = node('form'), goals = node('div', 'up-grid up-two');
      const values = data.preferences || { dailyGoal: 50, weeklyGoal: 350, interests: ['Strategy'] };
      const inputs = {};
      for (const [key, label, max] of [['dailyGoal', copy('Daily Goal · Points', 'Daily Goal · Points'), 1000], ['weeklyGoal', copy('Weekly Goal · Points', 'Weekly Goal · Points'), 7000]]) {
        const l = node('label', 'up-field', label), input = node('input');
        input.type = 'number'; input.min = '10'; input.max = String(max); input.step = '1'; input.required = true;
        input.value = String(values[key]); input.name = key;
        inputs[key] = input; l.append(input); goals.append(l);
      }
      const presets = node('div', 'up-goal-presets');
      for (const [daily, weekly, label] of [[25, 175, copy('Focused · 25 / 175', 'Fokus · 25 / 175')], [50, 350, copy('Steady · 50 / 350', 'Davamlı · 50 / 350')], [100, 700, copy('Intensive · 100 / 700', 'İntensiv · 100 / 700')]]) {
        const preset = button(label, () => { inputs.dailyGoal.value = String(daily); inputs.weeklyGoal.value = String(weekly); }, true);
        preset.disabled = busy; presets.append(preset);
      }
      form.append(goals, presets);

      const fieldset = node('fieldset', 'up-interests');
      fieldset.append(node('legend', '', copy('Skills to practice · choose one or more', 'Məşq sahələri · bir və ya bir neçəsini seç')));
      for (const category of data.categories) {
        const l = node('label', 'up-interest'), input = node('input');
        input.type = 'checkbox'; input.name = 'interest'; input.value = category; input.checked = values.interests.includes(category);
        l.append(input, node('span', '', category)); fieldset.append(l);
      }
      form.append(fieldset);

      let zone;
      if (firstTime) {
        const l = node('label', 'up-field', copy('Practice timezone', 'Məşq timezone-u'));
        zone = node('input'); zone.required = true; zone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Baku'; zone.maxLength = 80;
        l.append(zone); form.append(l);
      }

      form.append(node('p', 'up-muted', copy(`Days and Monday-based weeks use ${data.preferences?.timezone || 'your selected timezone'}. This practice timezone stays fixed to protect progress. Goals can be changed anytime.`, `Gün və bazar ertəsi başlayan həftə ${data.preferences?.timezone || 'seçilmiş timezone'} üzrə hesablanır. Progress-i qorumaq üçün məşq timezone-u sabit qalır. Hədəfləri istənilən vaxt dəyişə bilərsən.`)));
      const submit = node('button', 'up-button', busy ? copy('Saving…', 'Saxlanılır…') : firstTime ? copy('Start practicing', 'Məşqə başla') : copy('Save goals', 'Hədəfləri saxla'));
      submit.type = 'submit'; submit.disabled = busy;
      form.append(submit);

      form.addEventListener('submit', event => {
        event.preventDefault();
        const interests = [...form.querySelectorAll('input[name="interest"]:checked')].map(n => n.value);
        if (!interests.length) { error = copy('Choose at least one skill.', 'Ən azı bir sahə seç.'); draw(); return; }
        const payload = { dailyGoal: Number(inputs.dailyGoal.value), weeklyGoal: Number(inputs.weeklyGoal.value), interests, ...(firstTime ? { timezone: zone.value.trim() } : {}) };
        run(async () => {
          const next = await request(firstTime ? '/api/up/onboarding' : '/api/up/preferences', { method: firstTime ? 'POST' : 'PATCH', body: JSON.stringify(payload) });
          if (!valid()) return;
          data = next;
          settings = false;
        }, copy('Saving goals…', 'Hədəflər saxlanılır…'));
      });
      card.append(form); return card;
    }

    function home() {
      const summary = node('div', 'up-grid up-three');
      const points = node('section', 'up-card');
      points.append(
        node('h3', '', copy('Current Points', 'Cari Points')),
        node('p', 'up-big', String(data.totalPoints)),
        node('p', 'up-muted', copy(`${data.streak} day streak · earned through strategic decisions`, `${data.streak} günlük streak · tamamlanmış qərarlar əsasında`))
      );
      const level = node('section', 'up-card');
      const bar = node('progress');
      bar.max = data.level.next - data.level.floor;
      bar.value = data.totalPoints - data.level.floor;
      bar.setAttribute('aria-label', copy('Level progress', 'Level inkişafı'));
      level.append(
        node('h3', '', copy('Current Level', 'Cari Level')),
        node('p', 'up-big', String(data.level.level)),
        bar,
        node('p', 'up-muted', copy(`${data.level.next - data.totalPoints} Points to next level`, `Növbəti level üçün ${data.level.next - data.totalPoints} Points`))
      );
      summary.append(points, level, progress('Daily Goal', data.daily.points, data.daily.goal));

      const today = node('section', 'up-card up-today');
      const text = node('div');
      text.append(
        node('p', 'up-eyebrow', copy('Today’s Strategic Decision', 'Bu günün strateji qərarı')),
        node('h2', '', data.activeChallenge?.title || copy(`Test your ${data.recommendation.category} strategic judgment`, `${data.recommendation.category} strateji qərarverməsini sına`)),
        node('p', 'up-muted', copy('High-stakes executive dilemma selected from your focus areas and recent performance.', 'Fokus sahələriniz və son nəticələriniz əsasında seçilmiş gərgin situativ biznes keysi.'))
      );
      const cta = button(data.activeChallenge ? copy('Continue Decision', 'Qərara davam et') : copy('Start Challenge', 'Qərara başla'), () => {
        cta.disabled = true;
        if (!data.activeChallenge) {
          challenge = null;
          selectedOption = '';
          isGenerating = true;
          draw();
        }
        run(async () => {
          try {
            const nextChallenge = data.activeChallenge || await request('/api/up/challenges', { method: 'POST', body: JSON.stringify({ language: getLanguage() }) });
            if (!valid()) return;
            challenge = nextChallenge;
            selectedOption = challenge?.answer || '';
          } finally {
            isGenerating = false;
          }
        }, copy('Preparing your strategic decision…', 'Strateji keys hazırlanır…'));
      });
      cta.disabled = busy;
      today.append(text, cta);
      root.append(today, summary);

      if (data.generationRetryAt && new Date(data.generationRetryAt) > new Date(data.serverTime)) {
        root.append(notice(copy('Your strategic dilemma is being generated. This view will update automatically.', 'Strateji keys hazırlanır. Ekran avtomatik yenilənəcək.')));
        pendingPoll();
      }

      const bottom = node('div', 'up-grid up-bottom');
      const skills = node('section', 'up-card');
      skills.append(
        node('h2', '', 'Skill Map'),
        node('p', 'up-muted', copy('Decision indicators based on strategic accuracy, difficulty and consistency.', 'Strateji dəqiqlik, çətinlik və ardıcıllıq əsasında bacarıq xəritəsi.'))
      );
      for (const skill of data.skills) {
        const row = node('div', 'up-skill'), label = node('div', 'up-skill-label');
        label.append(node('strong', '', skill.category), node('span', 'up-muted', skill.completed ? `${skill.score} / 100 · ${skill.completed} ${copy('decisions', 'qərar')}` : copy('No practice yet', 'Hələ məşq yoxdur')));
        const skillBar = node('progress'); skillBar.max = 100; skillBar.value = skill.score; skillBar.setAttribute('aria-label', `${skill.category}: ${skill.score} / 100`);
        row.append(label, skillBar); skills.append(row);
      }
      bottom.append(skills, progress('Weekly Goal', data.weekly.points, data.weekly.goal));
      root.append(bottom);

      const history = node('section', 'up-card up-history');
      history.append(node('h2', '', copy('Recent decisions', 'Son qərarlar')));
      if (!data.history.length) {
        history.append(node('p', 'up-muted', copy('Your first completed strategic decision will appear here.', 'İlk tamamlanmış strateji qərarınız burada görünəcək.')));
      }
      for (const c of data.history) {
        history.append(button(`${c.title} · +${c.result.points} Points`, () => { challenge = c; draw(); }, true));
      }
      root.append(history, roadmapCard());
    }

    function roadmapCard() {
      const card = node('aside', 'up-card up-roadmap-card');
      const headerDiv = node('div', 'up-roadmap-header');
      const sparkle = node('span', 'up-roadmap-sparkle', '✨');
      sparkle.setAttribute('aria-hidden', 'true');
      headerDiv.append(
        sparkle,
        node('h3', 'up-roadmap-title', copy('More updates coming soon', 'Tezliklə daha çox yenilik'))
      );
      const text = node('p', 'up-roadmap-text', copy(
        'This feature is newly released. Over the coming weeks, updates like performance-based user tiers will be introduced — check back regularly!',
        'Bu funksiya hazırda istifadəyə yeni buraxılıb. Yaxın həftələr ərzində performansa görə istifadəçi səviyyələri kimi yeniliklər olacaq, mütəmadi yoxla!'
      ));
      card.append(headerDiv, text);
      return card;
    }

    function challengeView() {
      const c = challenge;
      const isCompleted = Boolean(c.result || c.status === 'completed');

      // Top Header & Minimalist Badges
      const topBar = node('div', 'up-topbar');
      const backBtn = button(copy('← UP home', '← UP başlanğıc'), () => {
        challenge = null;
        selectedOption = '';
        run(() => load(), copy('Loading progress…', 'Progress yüklənir…'));
      }, true);

      const badges = node('div', 'up-badges');
      const catPill = node('span', 'up-pill up-pill-cat', c.category);
      const diffName = c.difficultyName || (c.difficulty === 4 ? 'Executive' : c.difficulty === 3 ? 'Strategist' : c.difficulty === 2 ? 'Operator' : 'Starter');
      const diffPill = node('span', 'up-pill up-pill-diff', diffName);
      const maxPts = c.maximumPoints || 40;
      const ptsPill = node('span', 'up-pill up-pill-pts', `${copy('Max', 'Maks.')} ${maxPts} Points`);
      badges.append(catPill, diffPill, ptsPill);
      topBar.append(backBtn, badges);
      root.append(topBar);

      // Scenario Card
      const card = node('article', 'up-card up-scenario-card');
      card.append(
        node('p', 'up-eyebrow', copy('Strategic Decision · Executive Dilemma', 'Strateji qərar · Biznes dilemması')),
        node('h2', 'up-scenario-title', c.title),
        node('p', 'up-scenario-body', c.scenario),
        node('h3', 'up-question-title', c.question || copy('Which strategic decision would you take?', 'Hansı strateji qərarı seçərdiniz?'))
      );

      // 4 Strategic Options
      const options = (Array.isArray(c.options) && c.options.length === 4) ? c.options : [
        { id: 'A', text: copy('Focus on core unit economics and defend contribution margin.', 'Əsas unit-iqtisadiyyata fokuslanmaq və marjanı qorumaq.'), score: 40, is_optimal: true, trade_off: copy('Slower top-line expansion in exchange for cash sustainability.', 'Kassa dayanıqlılığı qarşılığında ümumi gəlir artımının ləngiməsi.') },
        { id: 'B', text: copy('Aggressively lower pricing to capture market share and ignite network effects.', 'Bazar payını ələ keçirmək və şəbəkə effektini alovlandırmaq üçün aqressiv qiymət endirimi etmək.'), score: 20, is_optimal: false, trade_off: copy('High cash burn and difficulty recovering pricing power later.', 'Kassa ehtiyatının sürətlə tükənməsi və sonradan qiymət gücünü bərpa etməkdə çətinlik.') },
        { id: 'C', text: copy('Differentiate with high-tier enterprise features to maximize contract value.', 'Müqavilə dəyərini artırmaq üçün yüksək səviyyəli enterprise funksiyalarla differensiasiya etmək.'), score: 30, is_optimal: false, trade_off: copy('Extended enterprise sales cycles and elevated client delivery burden.', 'Uzanmış satış tsiklləri və artan müştəri xidməti öhdəlikləri.') },
        { id: 'D', text: copy('Form an exclusive co-distribution alliance with an incumbent market leader.', 'Bazar lideri ilə eksklüziv paylama və tərəfdaşlıq ittifaqı qurmaq.'), score: 25, is_optimal: false, trade_off: copy('Loss of strategic autonomy and dependence on partner priorities.', 'Strateji sərbəstliyin azalması və tərəfdaşın prioritetlərindən asılılıq.') },
      ];

      const chosenOptionId = c.result?.selectedOptionId || c.answer || selectedOption || '';
      const optimalOptionId = c.result?.optimalOptionId || options.find(o => o.is_optimal)?.id || 'A';

      const optionsList = node('div', 'up-options-list');
      for (const opt of options) {
        const isChosen = chosenOptionId === opt.id;
        const isOptimal = opt.is_optimal || (isCompleted && opt.id === optimalOptionId);

        let optClass = 'up-option-card';
        if (!isCompleted && isChosen) optClass += ' is-selected';
        if (isCompleted) {
          if (isOptimal) optClass += ' is-optimal';
          if (isChosen && !isOptimal) optClass += ' is-suboptimal-chosen';
          if (!isChosen && !isOptimal) optClass += ' is-other';
        }

        const optBtn = node('button', optClass);
        optBtn.type = 'button';
        optBtn.setAttribute('data-id', opt.id);
        optBtn.disabled = isCompleted || busy;

        const pill = node('div', 'up-option-pill', opt.id);
        const body = node('div', 'up-option-body');
        const text = node('div', 'up-option-text', opt.text);
        body.append(text);

        if (isCompleted) {
          const tags = node('div', 'up-option-tags');
          if (isChosen) {
            tags.append(node('span', isOptimal ? 'up-tag up-tag-success' : 'up-tag up-tag-warning', copy('Your Decision', 'Sizin Qərarınız')));
          }
          if (isOptimal) {
            tags.append(node('span', 'up-tag up-tag-optimal', copy(`Optimal Move · +${opt.score || maxPts} Points`, `Ən Optimal Qərar · +${opt.score || maxPts} Points`)));
          } else if (opt.score !== undefined) {
            tags.append(node('span', 'up-tag up-tag-neutral', `+${opt.score} Points`));
          }
          body.append(tags);

          if (opt.trade_off) {
            body.append(node('p', 'up-option-tradeoff', `⚖️ ${opt.trade_off}`));
          }
        }

        optBtn.append(pill, body);

        if (!isCompleted) {
          optBtn.addEventListener('click', () => {
            selectedOption = opt.id;
            optionsList.querySelectorAll('.up-option-card').forEach(b => {
              b.classList.toggle('is-selected', b.getAttribute('data-id') === opt.id);
            });
            const confirmBtn = card.querySelector('.up-confirm-btn');
            if (confirmBtn) confirmBtn.disabled = false;
          });
        }

        optionsList.append(optBtn);
      }

      card.append(optionsList);

      // Confirm CTA Button (Disabled until an option is chosen)
      if (!isCompleted) {
        const confirmBtn = button(copy('Confirm Decision', 'Qərarı Təsdiq Et'), () => {
          if (!selectedOption) return;
          run(async () => {
            const nextChallenge = await request(`/api/up/challenges/${c.id}/submit`, {
              method: 'POST',
              body: JSON.stringify({ selectedOption, language: getLanguage() }),
            });
            if (!valid()) return;
            challenge = nextChallenge;
            const nextData = await request('/api/up');
            if (!valid()) return;
            data = nextData;
          }, copy('Evaluating strategic decision…', 'Strateji qərar təsdiqlənir…'));
        });
        confirmBtn.classList.add('up-confirm-btn');
        confirmBtn.disabled = !selectedOption || busy;
        card.append(confirmBtn);
      }

      root.append(card);

      // Single Unified Compact Result Card
      if (isCompleted && c.result) {
        card.classList.add('is-completed-scenario');

        const resultCard = node('section', 'up-card up-result-card');

        // 2. Score & Status Header
        const headerRow = node('div', 'up-result-header');
        const scoreGroup = node('div', 'up-result-score-wrap');
        const pointsBadge = node('span', 'up-earned-badge', `+${c.result.points} Points`);
        const optimalTag = node('span', c.result.isOptimal ? 'up-tag up-tag-optimal' : 'up-tag up-tag-warning',
          c.result.isOptimal ? copy('Optimal Decision', 'Optimal Qərar') : copy('Strategic Choice', 'Seçilmiş Qərar'));
        scoreGroup.append(pointsBadge, optimalTag);

        const statusWrap = node('div', 'up-result-status');
        let statusText = '';
        if (c.result.milestones?.includes('daily_goal_completed')) {
          statusText = copy('✓ Daily goal complete', '✓ Gündəlik hədəf tamamlandı');
        } else if (c.result.milestones?.includes('weekly_goal_completed')) {
          statusText = copy('✓ Weekly goal complete', '✓ Həftəlik hədəf tamamlandı');
        } else if (c.result.milestones?.includes('level_increased')) {
          statusText = copy(`✓ Level up · Level ${data.level?.level || ''}`, `✓ Level yüksəldi · Level ${data.level?.level || ''}`);
        } else {
          statusText = copy('✓ Decision evaluated', '✓ Qərar qeydə alındı');
        }
        statusWrap.textContent = statusText;
        headerRow.append(scoreGroup, statusWrap);

        // 3. Middle Section: Two compact internal blocks (Analysis & Insight)
        const tradeOffText = c.result.tradeOff || options.find(o => o.id === chosenOptionId)?.trade_off;
        const tradeBlock = node('div', 'up-result-block up-tradeoff-card');
        tradeBlock.append(
          node('h4', 'up-block-title', copy('Trade-off & Strategic Risk', 'Strateji Təhlil & Trade-off Riski')),
          node('p', 'up-block-body', tradeOffText || copy('Evaluated against operational and capital constraints.', 'Əməliyyat və kapital məhdudiyyətləri əsasında təhlil edildi.'))
        );

        const insightText = c.result.insiderInsight || c.insider_insight || options.find(o => o.id === optimalOptionId)?.trade_off;
        const insightBlock = node('div', 'up-result-block up-executive-insight');
        insightBlock.append(
          node('h4', 'up-block-title up-eyebrow', copy('Executive Insight', 'Executive Insight · Real dünya dərsi')),
          node('p', 'up-block-body', insightText || '')
        );

        // 4. Footer: Right-aligned compact Next Decision CTA button
        const footerRow = node('div', 'up-result-footer');
        const nextBtn = button(copy('Next Decision →', 'Növbəti Qərar →'), () => {
          nextBtn.disabled = true;
          challenge = null;
          selectedOption = '';
          isGenerating = true;
          draw();
          run(async () => {
            try {
              const nextChallenge = data.activeChallenge || await request('/api/up/challenges', { method: 'POST', body: JSON.stringify({ language: getLanguage() }) });
              if (!valid()) return;
              challenge = nextChallenge;
              selectedOption = challenge?.answer || '';
            } finally {
              isGenerating = false;
            }
          }, copy('Preparing…', 'Hazırlanır…'));
        });
        nextBtn.classList.add('up-next-btn');
        nextBtn.disabled = busy;
        footerRow.append(nextBtn);

        resultCard.append(headerRow, tradeBlock, insightBlock, footerRow);
        root.append(resultCard);
      }
    }

    function generatingView() {
      const topBar = node('div', 'up-topbar');
      const backBtn = button(copy('← UP home', '← UP başlanğıc'), () => {
        isGenerating = false;
        challenge = null;
        selectedOption = '';
        run(() => load(), copy('Loading progress…', 'Progress yüklənir…'));
      }, true);
      backBtn.disabled = busy;

      const badges = node('div', 'up-badges');
      badges.append(
        node('span', 'up-skeleton up-skeleton-pill'),
        node('span', 'up-skeleton up-skeleton-pill'),
        node('span', 'up-skeleton up-skeleton-pill')
      );
      topBar.append(backBtn, badges);
      root.append(topBar);

      const card = node('article', 'up-card up-scenario-card up-generating-card');

      const loader = node('div', 'up-generating-status');
      const spinner = node('div', 'up-spinner');
      spinner.setAttribute('aria-hidden', 'true');
      const text = node('span', 'up-generating-text', copy('Preparing…', 'Hazırlanır'));
      loader.append(spinner, text);
      card.append(loader);

      card.append(
        node('div', 'up-skeleton up-skeleton-eyebrow'),
        node('div', 'up-skeleton up-skeleton-title')
      );

      const lines = node('div', 'up-skeleton-lines');
      lines.append(
        node('div', 'up-skeleton up-skeleton-line'),
        node('div', 'up-skeleton up-skeleton-line'),
        node('div', 'up-skeleton up-skeleton-line up-skeleton-line-short')
      );
      card.append(lines);
      card.append(node('div', 'up-skeleton up-skeleton-question'));

      const optionsList = node('div', 'up-options-list up-skeleton-options');
      for (let i = 0; i < 4; i++) {
        const optCard = node('div', 'up-skeleton-option-card');
        const pill = node('div', 'up-skeleton up-skeleton-option-pill');
        const optLines = node('div', 'up-skeleton-option-lines');
        optLines.append(
          node('div', 'up-skeleton up-skeleton-line'),
          node('div', 'up-skeleton up-skeleton-line up-skeleton-line-short')
        );
        optCard.append(pill, optLines);
        optionsList.append(optCard);
      }
      card.append(optionsList);

      root.append(card);
    }

    function draw(message) {
      if (!valid()) return;
      clearTimeout(timer);
      root.replaceChildren(header());
      if (error) root.append(notice(error, true));
      root.setAttribute('aria-busy', String(busy));
      if (busy && !isGenerating) root.append(notice(message || copy('Processing…', 'İcra olunur…')));
      if (!data) {
        root.append(notice(copy('Loading your progress…', 'Progress yüklənir…')));
        if (error) root.append(button(copy('Retry', 'Yenidən yoxla'), () => run(() => load(), copy('Loading…', 'Yüklənir…'))));
        return;
      }
      if (!data.onboardingComplete || settings) {
        root.append(preferencesForm(!data.onboardingComplete));
      } else if (isGenerating) {
        generatingView();
      } else if (challenge) {
        challengeView();
      } else {
        home();
      }
    }

    if (!userId) {
      root.append(
        header(),
        notice(copy('Sign in to test strategic decisions and save progress to your Helmer account.', 'Strateji qərarları sınamaq və nəticələri saxlamaq üçün daxil olun.')),
        button(copy('Sign in', 'Hesaba daxil ol'), onLogin),
        roadmapCard()
      );
      return;
    }

    draw();
    load(true).catch(e => { if (valid()) { error = e.message; draw(); } });
  };
}
