/**
 * Helmer — Centralized Localization & Internationalization (i18n)
 * Supports Azerbaijani ('az') and English ('en') with zero machine translation.
 */

const STORAGE_KEY = "helmer_language";
const DEFAULT_LANGUAGE = "az";
const SUPPORTED_LANGUAGES = new Set(["az", "en"]);

export const TRANSLATIONS = {
  az: {
    // ── Global & Brand ────────────────────────────────────────────────────────
    brand: {
      name: "Helmer",
      tagline: "Biznes məqsədini strukturlaşdırılmış strategiyaya çevirir.",
      workspaceName: "Helmer",
      personalAccount: "Şəxsi hesab",
      guestAccount: "Qonaq hesabı",
      homeAriaLabel: "Helmer ana səhifə",
    },

    // ── Navigation & Rail ─────────────────────────────────────────────────────
    nav: {
      skipToMain: "Əsas hissəyə keç",
      menu: "Menyu",
      openMenu: "Workspace menyusunu aç",
      closeMenu: "Menyunu bağla",
      home: "Başlanğıc",
      askChat: "Söhbət",
      archive: "Arxiv",
      planner: "Planlaşdırılanlar",
      up: "Helmer UP",
      comingSoon: "Tezliklə",
      limits: "İstifadə",
      installApp: "Tətbiqi yüklə",
      whatsNew: "Yeniliklər",
      settings: "Parametrlər",
      search: "Axtarış",
      searchChats: "Axtarış",
      searchPlaceholder: "Axtarış...",
      newStrategy: "Yeni strategiya",
      newChat: "Yeni söhbət",
      recentWork: "Son işlər",
      chatHistory: "Söhbət tarixçəsi",
      recentWorkEmptyTitle: "Strategiyalar burada görünəcək.",
      recentWorkEmptySubtitle: "Yadda saxladığın işlər bu bölmədə qalır.",
      recentChatsEmptyTitle: "Söhbətlər burada görünəcək.",
      recentChatsEmptySubtitle: "Aparılan müzakirələr bu bölmədə qalır.",
      modeSwitchAria: "İş rejimi",
      modeBuild: "Build",
      modeAsk: "Ask",
      switchToAsk: "Ask rejiminə keç",
      switchToBuild: "Build rejiminə keç",
      modeTooltipBuildToAsk: "Rejim: Build (Ask-a keç)",
      modeTooltipAskToBuild: "Rejim: Ask (Build-ə keç)",
      quickNavAria: "Sürətli naviqasiya",
      mainNavAria: "Əsas naviqasiya",
      workspaceAria: "Workspace",
      shortcuts: "Qısayollar",
      terms: "İstifadə şərtləri",
      privacy: "Məxfilik siyasəti",
      languageToggle: "Dili dəyiş (EN)",
      languageToggleAria: "İnterfeys dilini ingilis dilinə dəyiş",
      themeToggleDark: "Dark Mode-a keç",
      themeToggleLight: "Light Mode-a keç",
      accountSettings: "Hesab tənzimləmələri",
      openAccountSettings: "Hesab tənzimləmələrini aç",
    },

    // ── User Profile Menu ──────────────────────────────────────────────────
    profileMenu: {
      ariaLabel: "İstifadəçi profil menyusu",
      personalization: "Fərdiləşdirmə",
      personalizationAz: "Fərdiləşdirmə",
      profile: "Profil",
      profileAz: "Profil",
      settings: "Parametrlər",
      settingsAz: "Parametrlər",
      security: "Təhlükəsizlik",
      securityAz: "Təhlükəsizlik",
      legal: "Hüquqi",
      legalAz: "Hüquqi",
      help: "Kömək",
      helpAz: "Kömək",
      logout: "Çıxış",
      logoutAz: "Çıxış",
      planFree: "Pulsuz Plan",
      planPro: "Pro Plan",
      planPersonal: "Şəxsi",
      planGuest: "Qonaq Planı",
      guestUser: "Qonaq İstifadəçi",
    },

    // ── Support Chat Bubble ────────────────────────────────────────────────
    supportBubble: {
      greeting: "Salam {name}, kömək lazımdır?",
      greetingGuest: "Salam, kömək lazımdır?",
      ariaLabel: "Kömək və Dəstək",
      popoverTitle: "Kömək və Dəstək",
      popoverSubtitle: "Suallarınız və ya təklifləriniz üçün bizə yazın.",
      emailOptionLabel: "E-poçt vasitəsilə yazın",
      copyEmail: "Ünvanı kopyala",
      copied: "Kopyalandı!",
      close: "Bağla",
    },

    // ── Keyboard Shortcuts ───────────────────────────────────────────────────
    shortcuts: {
      title: "Klaviatura qısayolları",
      subtitle: "{platform} üçün sürətli idarəetmə",
      closeAria: "Qısayollar pəncərəsini bağla",
      hint: "Qısayollar mətn sahəsində yazarkən də işləyir. Bu siyahını açmaq üçün ⌘/Ctrl + / və ya ? bas.",
      or: "və",
      items: {
        newStrategyOrChat: "Yeni strategiya və ya söhbət",
        home: "Başlanğıc",
        archive: "Arxiv",
        planner: "Planlaşdırılanlar",
        settings: "Parametrlər",
        modeToggle: "Build və Ask rejimi arasında keçid",
        toggleMode: "Build və Ask rejimi arasında keçid",
        closeModal: "Bu pəncərəni bağla",
      },
    },

    // ── Build Intake (Home) ──────────────────────────────────────────────────
    intake: {
      kicker: "STRATEGIYA QURUCUSU",
      title: "Biznes məqsədini strategiyaya çevir.",
      subtitle: "Konteksti daxil et. Helmer çatışmayan məqamları dəqiqləşdirir və icraya hazır plan qurur.",
      placeholder: "Məsələn: Bakıda yeni premium coffee shop açırıq. 6 aylıq bazara giriş strategiyası və rəqəmsal marketinq planı lazımdır...",
      submitButton: "Strategiyanı qur",
      submitThinking: "Düşünür…",
      submitAnalyzing: "Təhlil edilir…",
      attachFile: "Fayl əlavə et",
      attachFileTooltip: "PDF, Word, TXT (maks. 10MB)",
      removeFile: "Faylı sil",
      suggestionsTitle: "Hazır nümunələr",
      fileTooLarge: "Fayl ölçüsü 10MB-dan çox ola bilməz.",
      fileInvalidType: "Yalnız PDF, DOCX, TXT və MD faylları dəstəklənir.",
      errorEmptyPrompt: "Zəhmət olmasa biznes məqsədinizi və ya layihənizi təsvir edin.",
    },

    // ── Clarification ────────────────────────────────────────────────────────
    clarification: {
      kicker: "DƏQİQLƏŞDİRMƏ",
      title: "Daha dəqiq strategiya üçün bir neçə sual",
      subtitle: "Helmer konteksti analiz etdi. Aşağıdakı sualları cavablandırmaqla daha uyğun və tətbiq oluna bilən nəticə əldə edəcəksən.",
      questionCounter: "Sual {current} / {total}",
      skipQuestion: "Bu sualı ötür",
      skipAll: "Dərhal strategiyanı qur",
      nextButton: "Növbəti sual",
      finishButton: "Tamamla və Strategiyanı Qur",
      textPlaceholder: "Cavabınızı bura daxil edin və ya əlavə qeyd yazın...",
      customOptionPlaceholder: "Öz variantını yaz...",
      optionOther: "Digər variant",
      generatingStrategy: "Strategiya tərtib olunur…",
    },

    // ── Loading Screen ───────────────────────────────────────────────────────
    loading: {
      title: "Strategiyanız hazırlanır",
      subtitle: "Biznes konteksti analiz edilir, strateji prioritetlər və icra planı tərtib olunur.",
      bgJobNote: "Səhifədən ayrılsanız belə proses fonda davam edəcək və Arxivdə saxlanılacaq.",
      tips: [
        "Biznes konteksti və bazar təhlil edilir…",
        "Hədəf auditoriya və mövqelənmə dəqiqləşdirilir…",
        "Marketinq kanalları və büdcə optimallaşdırılır…",
        "Addım-addım icra və fəaliyyət planı qurulur…",
        "Ölçülə bilən KPI-lar və risklərin idarə olunması təyin edilir…",
        "Yekun strateji sənəd tərtib olunur…",
      ],
    },

    // ── Strategy Workspace ───────────────────────────────────────────────────
    strategy: {
      titlePlaceholder: "Strategiyanın adı",
      versionBadge: "v{version}",
      versionTooltip: "Versiya tarixçəsi",
      statusDraft: "Qaralama",
      statusSaved: "Yadda saxlanıldı",
      statusSaving: "Saxlanılır…",
      statusDirty: "Dəyişikliklər var",
      copyLink: "Keçidi kopyala",
      linkCopied: "Keçid kopyalandı",
      duplicate: "Kopyasını yarat",
      duplicatedToast: "Strategiyanın nüsxəsi yaradıldı.",
      exportMenu: "İxrac et",
      exportPdf: "PDF formatında yüklə",
      exportDocx: "Word (.docx) formatında yüklə",
      exportXls: "Excel (.xls) cədvəli",
      exportCsv: "CSV formatında ixrac",
      exportMarkdown: "Markdown formatında kopyala",
      markdownCopied: "Markdown mətni panoya kopyalandı.",
      pdfGenerating: "PDF hazırlanır…",
      sections: {
        priorities: "01. Strateji Prioritetlər",
        positioning: "02. Mövqelənmə və Bazar Uyğunluğu",
        actionPlan: "03. İcra Mərhələləri",
        kpis: "04. Uğur və KPI Hədəfləri",
        risks: "05. Risklər və Həll Yolları",
        nextSteps: "06. Növbəti Addımlar",
      },
      badges: {
        priority: "Prioritet",
        phase: "Mərhələ {number}",
        target: "Hədəf:",
        expectedOutcome: "Gözlənilən nəticə:",
        risk: "Risk",
        mitigation: "Həll yolu:",
        timeGroupToday: "Bu gün",
        timeGroup48h: "Növbəti 48 saat",
        timeGroupWeek: "Bu həftə",
      },
      actions: {
        addToPlanner: "Planlaşdırılanlara əlavə et",
        addedToPlanner: "Əlavə edildi",
        addAllToPlanner: "Bütün addımları əlavə et",
        askAiAboutStrategy: "AI ilə müzakirə et",
        refineStrategy: "Dəqiqləşdir və Yenilə",
      },
      refinement: {
        title: "Strategiyanı dəqiqləşdir",
        subtitle: "Konkret istiqamət seçin və ya xüsusi dəyişiklik tələbini yazın.",
        options: {
          shorten: "Daha qısa et",
          localize_azerbaijan: "Azərbaycan bazarına uyğunlaşdır",
          think_deeper: "Dərindən təhlil et",
          make_practical: "Daha praktik et",
          budget_optimize: "Büdcəni optimallaşdır",
          custom: "Xüsusi dəqiqləşdirmə",
        },
        customPlaceholder: "Strategiyada nəyi dəyişmək və ya əlavə etmək istəyirsiniz?",
        submitButton: "Dəqiqləşdirməni tətbiq et",
        applying: "Tətbiq edilir…",
      },
      askDrawer: {
        title: "Strategiya üzrə AI məsləhətçi",
        subtitle: "Bu strategiyanın detalları, icra addımları və ya riskləri barədə sual verin.",
        placeholder: "Bu strategiya haqqında sual verin...",
        send: "Göndər",
      },
      summary: {
        button: "Xülasə",
        buttonAria: "Strategiyanın xülasəsini göstər",
        title: "Strategiyanın Xülasəsi",
        badge: "Kəsərli İcmal",
        objectiveTitle: "Hədəf və Fokus",
        movesTitle: "Əsas Strateji Gedişlər",
        executionTitle: "İcra İstiqaməti",
        kpiTitle: "Büdcə və KPI-lar",
        takeawayTitle: "Kəsərli Yekun",
        copy: "Xülasəni kopyala",
        copied: "Kopyalandı!",
        close: "Bağla",
        loading: "Strategiyanın xülasəsi hazırlanır…",
        error: "Xülasə hazırlana bilmədi. Yenidən cəhd edin.",
        retry: "Yenidən cəhd et",
      },
    },

    // ── Ask Workspace (Chat) ─────────────────────────────────────────────────
    ask: {
      kicker: "AI MƏSLƏHƏTÇİ",
      title: "Marketinq və biznes suallarını araşdır.",
      subtitle: "Rəqibləri analiz et, kampaniya ideyalarını sınaqdan keçir, büdcə və kanalları müqayisə et.",
      modelSelectorLabel: "Model:",
      modelAuto: "Avtomatik",
      modelFlash: "Gemini 3.8 Flash",
      thinkingToggle: "Dərindən düşün",
      searchToggle: "Veb axtarış",
      newChat: "Yeni söhbət",
      clearChatConfirm: "Cari söhbəti sıfırlamaq istədiyinizə əminsiniz?",
      placeholder: "Marketinq sualınızı yazın... (Enter ilə göndər)",
      send: "Göndər",
      stop: "Dayandır",
      attachFile: "Fayl əlavə et",
      attachFileTooltip: "PDF, Word, TXT, Şəkil",
      thinkingProcess: "Düşünmə prosesi",
      hideThinking: "Düşüncəni gizlə",
      showThinking: "Düşüncəni göstər",
      sources: "Mənbələr ({count})",
      webSearchBadge: "Google Axtarış",
      copyMessage: "Kopyala",
      messageCopied: "Kopyalandı",
      regenerate: "Yenidən yarat",
      addToPlanner: "Planlaşdırılana əlavə et",
      reportMessage: "Şikayət et",
      suggestedQuestions: "Tövsiyə olunan suallar",
      exportChat: "Söhbəti ixrac et",
      deleteChatConfirm: "Bu söhbət tarixçəsini silmək istəyirsiniz?",
      contextSheet: {
        title: "Kontekst əlavə et",
        files: "Fayllar",
        filesDesc: "PDF və sənədlər",
        photos: "Şəkillər / Kamera",
        photosDesc: "Vizual analiz üçün",
        strategies: "Strategiyalarım",
        strategiesDesc: "Yadda saxlanılan strategiyaları kontekstə əlavə et",
        tasks: "Planlaşdırılanlar",
        tasksDesc: "Aktiv taskı kontekst kimi seç",
        deepResearch: "Dərin Araşdırma",
        deepResearchDesc: "Bazar və rəqib analizi hesabatı",
        promptTemplates: "Hazır sual",
        promptTemplatesDesc: "Başlamaq üçün hazır prompt şablonları",
        personalIntelligence: "Personal Intelligence",
        personalIntelligenceDesc: "Çat kontekstində fərdiləşdirmə",
        personalIntelligenceOn: "Aktivdir",
        personalIntelligenceOff: "Qeyri-aktivdir",
        clearContext: "Konteksti sil",
        back: "Geri",
        emptyStrategies: "Arxiv hələ boşdur.",
        emptyTasks: "Aktiv planlaşdırılan task yoxdur.",
      },
      contextActions: {
        ariaToolbar: "Kontekst üzrə sürətli əməliyyatlar",
        analyze: "Analiz et",
        analyzePrompt: "Bu strategiyanı ətraflı analiz et: əsas güclü və zəif tərəflərini, kritik riskləri və ən vacib inkişaf imkanlarını prioritetləşdir.",
        prosAndCons: "Müsbət və mənfi tərəflərini araşdır",
        prosAndConsPrompt: "Bu strategiyanın bütün müsbət və mənfi cəhətlərini obyektiv araşdır, potensial təhlükələri və alternativ yanaşmaları qiymətləndir.",
        roadmap: "İcra xəritəsi hazırla",
        roadmapPrompt: "Bu strategiyanın uğurla icrası üçün mərhələli fəaliyyət xəritəsi hazırla: addım-addım prioritetlər, zaman qrafiki və əsas KPI-lar daxil olsun.",
        bottlenecks: "Darboğaz və riskləri tap",
        bottlenecksPrompt: "Bu strategiyanın həyata keçirilməsində yarana biləcək əsas darboğazları, resurs çatışmazlıqlarını və uğursuzluq risklərini stress-test et.",
        taskPlan: "İcra planı qur",
        taskPlanPrompt: "Bu tapşırığı uğurla və operativ icra etmək üçün addım-addım konkret plan və ən yaxşı təcrübələri təqdim et.",
        taskBlockers: "Maneə və riskləri tap",
        taskBlockersPrompt: "Bu tapşırığın icrası zamanı hansı maneələr və risklər yarana bilər? Onları necə qabaqlamaq olar?",
        taskEffort: "Resurs və zaman bölgüsü",
        taskEffortPrompt: "Bu tapşırıq üçün tələb olunan təxmini vaxt, zəruri resurslar və uğur meyarlarını strukturlaşdır.",
        taskSteps: "Hərəkətə keçmə addımları",
        taskStepsPrompt: "Bu tapşırığa dərhal başlamaq üçün ilk 3 ən vacib praktik addımı sırala.",
      },
      modelSheet: {
        title: "Model seçimi",
        autoTitle: "Auto",
        autoDesc: "Avtomatik intellektual rejim",
        newBadge: "Yeni",
        flashTitle: "Flash",
        flashDesc: "Gündəlik işlər, veb axtarış və sürətli cavablar",
        thinkingTitle: "Düşünmə (Thinking)",
        thinkingOn: "Dərin analiz aktivdir",
        thinkingOff: "Sürətli birbaşa cavab",
      },
    },

    // ── Archive ──────────────────────────────────────────────────────────────
    archive: {
      kicker: "İŞ TARİXÇƏSİ",
      title: "Arxiv",
      subtitle: "Bütün saxlanılmış strategiyalar və apardığınız müzakirələr.",
      searchPlaceholder: "Strategiya və ya söhbət axtar...",
      filterAll: "Hamısı",
      filterStrategies: "Strategiyalar",
      filterChats: "Söhbətlər",
      sortRecent: "Ən son",
      sortAlpha: "Əlifba sırası",
      sortOldest: "Ən köhnə",
      updatedAt: "Yeniləndi: {date}",
      versionsCount: "{count} versiya",
      messagesCount: "{count} mesaj",
      emptyAllTitle: "Heç bir qeyd tapılmadı.",
      emptyAllSubtitle: "Yeni strategiya və ya söhbətə başlayaraq işinizi burada saxlaya bilərsiniz.",
      emptyFilterTitle: "Nəticə tapılmadı.",
      emptyFilterSubtitle: "Axtarış sorğusunu dəyişin və ya filtri sıfırlayın.",
      deleteConfirmTitle: "Silinməni təsdiqləyin",
      deleteConfirmBody: '"{title}" silinsin? Bu əməliyyat geri qaytarıla bilməz.',
      cancel: "Ləğv et",
      delete: "Sil",
      deletedToast: "Uğurla silindi.",
      open: "Aç",
      bgCtaTag: "Vaxta qənaət",
      bgCtaTitle: "Vaxtın yoxdur? Generasiya səhifəsində işi Helmer-ə tapşır!",
      bgCtaDesc: "Strategiyanın hazırlanmasını gözləmək məcburiyyətində deyilsən — generasiya zamanı «İşi arxa planda davam etdir» seçimini et, proses fonda tamamlansın və nəticə birbaşa Arxivinə əlavə olunsun.",
      bgCtaAction: "Yeni strategiya",
      bgCtaDismiss: "Bağla",
      buildSomethingNew: "Yeni bir şey qur",
      viewAll: "Hamısına bax",
      recentStrategies: "Son strategiyalar",
      noStrategiesYet: "Hələ strategiya yoxdur",
      researchTipTitle: "Növbəti dəfə daha az gözləmək istəyirsən?",
      researchTipDesc: "Ask rejimində yeni Deep Research funksiyasını yoxla! Oxşar performansla sürətin sintezini əldə et.",
      researchTipAction: "Yoxla",
      researchTipTag: "Deep Research",
      researchTipDismiss: "Bağla",
    },

    // ── Planner ──────────────────────────────────────────────────────────────
    planner: {
      kicker: "İCRA NƏZARƏTİ",
      title: "Planlaşdırılanlar",
      subtitle: "Strategiyalardan və söhbətlərdən toplanmış icra tapşırıqları.",
      filterAll: "Hamısı ({count})",
      filterActive: "Aktiv ({count})",
      filterCompleted: "Tamamlanan ({count})",
      inputPlaceholder: "Yeni tapşırıq əlavə et... (Enter ilə saxla)",
      groupSelectGeneral: "Ümumi",
      addButton: "Əlavə et",
      emptyTitle: "Hələ heç bir tapşırıq yoxdur.",
      emptySubtitle: "Strategiyalardan və ya söhbətlərdən tapşırıqları bura əlavə edərək icraya başlayın.",
      taskCompletedToast: "Tapşırıq tamamlandı.",
      taskReopenedToast: "Tapşırıq yenidən aktiv edildi.",
      taskDeletedToast: "Tapşırıq silindi.",
      deleteTaskAria: "Tapşırığı sil",
      addToPlannerBtn: "✦ AI ilə xülasələ və əlavə et",
      addAllManualBtn: "Olduğu kimi əlavə et",
      summarizingWithAi: "✦ AI ilə xülasələnir…",
      modalBadge: "✦ AI Xülasəsi",
      modalBadgeRaw: "Orijinal mətnlər",
      modalTitle: "Planlaşdırılanlara əlavə et",
      modalSubtitle: "AI tərəfindən xülasələnmiş və optimallaşdırılmış icra addımları.",
      modalSubtitleRaw: "Strategiyadakı orijinal icra addımları.",
      tabAiSummary: "✦ AI Xülasəsi",
      tabOriginal: "Olduğu kimi",
      selectAll: "Hamısını seç",
      deselectAll: "Seçimi ləğv et",
      selectedCount: "{total} tapşırıqdan {selected} seçilib",
      addSelectedBtn: "Seçilənləri əlavə et ({count})",
      cancelBtn: "İmtina",
      singleAdded: "Əlavə edildi",
      singleAdd: "Planlaşdır",
      toastSingleAdded: "1 tapşırıq Planner-ə əlavə edildi ✓",
      toastBulkAdded: "{count} tapşırıq Planner-ə əlavə edildi ✓",
      toastManualAdded: "{count} tapşırıq olduğu kimi Planner-ə əlavə edildi ✓",
      executeTask: "İcra et",
      generateRoadmap: "İcra xəritəsi hazırla",
      tasksSelected: "{count} tapşırıq seçildi",
      filterPriority: "Prioritet",
      priorityNewBadge: "New",
      priorityModelBadge: "AI ilə ayrılıb",
      priorityBannerTitle: "AI ilə ayrılmış prioritetlər",
      priorityBannerSubtitle: "Biznesin inkişafı və kritik icra üçün ən yüksək təsirə malik tapşırıqlar.",
      reprioritizeWithLuna: "Yenidən ayır (AI)",
      prioritizingWithLuna: "Tapşırıqlar təhlil edilir və ayrılır...",
      prioritizeSuccess: "{count} prioritet tapşırıq ayrıldı ✓",
      noPriorityTasks: "Hələ prioritet tapşırıq yoxdur",
      noPriorityDesc: "Tapşırıqlarınızdan yüksək təsirli olanları avtomatik ayırmaq üçün AI modelini işə salın.",
      prioritizeBtn: "Prioritetləri ayır",
      markPriority: "Prioritet et",
      unmarkPriority: "Prioritetdən çıxar",
      notifications: "Bildirişlər",
      notificationsTooltip: "Planlaşdırılanlar bildirişləri",
      notifGreeting: "Salam, {name}! Planlaşdırılanlarda hələ də icra gözləyən prioritet tapşırıq(ların) mövcuddur. Nəzərdən keçirməyi unutma.",
      notifWindowSubtitle: "İcra gözləyən prioritet tapşırıqlar",
      notifRemindLater: "Daha sonra xatırlat",
      notifReviewTasks: "Nəzərdən keçir",
      notifDeactivate: "Deaktiv et",
      notifRemindersActive: "Xatırlatmalar aktivdir",
      notifAllCaughtUp: "Hər şey qaydasındadır",
      notifAllCaughtUpDesc: "İcra gözləyən prioritet tapşırıq yoxdur ✓",
      notifSnoozedToast: "Xatırlatma 2 saatlıq təxirə salındı",
      notifDisabledToast: "Planlaşdırılanlar bildirişləri deaktiv edildi",
      notifEnabledToast: "Planlaşdırılanlar bildirişləri aktiv edildi",
      notifDueBadge: "Təcili",
      taskHelpfulQuestion: "Bu tapşırıq faydalı oldu?",
      taskHelpfulYes: "Faydalı oldu",
      taskHelpfulNo: "Faydalı olmadı",
      taskFeedbackRecorded: "Rəyiniz qeydə alındı ✓",
    },


    // ── Limits & Usage ───────────────────────────────────────────────────────
    limits: {
      kicker: "İSTİFADƏ VƏ PLAN",
      title: "İstifadə və Limitlər",
      subtitle: "Cari dövr üçün istifadə statistikası və hesab imkanları.",
      periodToday: "Bu gün",
      periodMonth: "Bu ay",
      periodAllTime: "Bütün dövr",
      buildUsageTitle: "Build Rejimi",
      buildUsageSubtitle: "Strategiya generasiyaları",
      askUsageTitle: "Ask Rejimi",
      askUsageSubtitle: "AI sorğuları",
      contextUsageTitle: "Yaddaş və Kontekst",
      contextUsageSubtitle: "Saxlanılan strategiyalar",
      resetNotice: "Gündəlik limitlər hər gün saat 00:00-da yenilənir.",
      featureBreakdownTitle: "Daxil olan imkanlar",
      features: {
        buildGen: "Tam marketinq strategiyası generasiyası",
        askQueries: "AI ilə operativ sual-cavab və araşdırma",
        exportFormats: "PDF, DOCX, Excel və CSV formatlarında ixrac",
        webSearch: "Veb axtarış və canlı mənbələr",
        memoryHub: "Memory Hub və fərdiləşdirilmiş kontekst",
        unlimitedStorage: "Buludda saxlanılan arxiv və tarixçə",
      },
    },

    // ── Settings ─────────────────────────────────────────────────────────────
    settings: {
      kicker: "WORKSPACE",
      title: "Parametrlər",
      subtitle: "Hesab məlumatlarını, fərdiləşdirməni və interfeys parametrlərini idarə et.",
      guestTitle: "Gedişatını qoruyun",
      guestSubtitle: "Hesabsız istifadə edə bilərsən. Hesab yaratdıqda bu cihazdakı strategiyaların profilinə köçürüləcək və başqa cihazlardan da əlçatan olacaq.",
      guestPanelTitle: "Hesab məcburi deyil",
      guestPanelIntro: "Hazırkı işlərin bu brauzerdə saxlanılır. Cihaz dəyişdikdə itirməmək üçün pulsuz hesab yaratmağı tövsiyə edirik.",
      guestSignupBtn: "Hesab yarat",
      guestLoginBtn: "Daxil ol",
      tabs: {
        account: "Hesab",
        experience: "Fərdiləşdirmə",
        security: "Təhlükəsizlik",
        legal: "Hüquqi & Məxfilik",
      },
      languageSelector: {
        title: "İnterfeys dili",
        intro: "Helmer üçün istifadə etmək istədiyiniz dili seçin.",
        az: "Azərbaycan dili",
        en: "English",
        toastChanged: "İnterfeys dili dəyişdirildi.",
      },
      account: {
        title: "Hesab məlumatları",
        intro: "Workspace-də görünən adını və giriş məlumatlarını yenilə.",
        fullName: "Ad və soyad",
        username: "İstifadəçi adı",
        email: "E-poçt",
        saveBtn: "Dəyişiklikləri saxla",
        saving: "Saxlanılır…",
        successToast: "Hesab məlumatları yeniləndi.",
        dangerZoneTitle: "Təhlükəli Zona",
        deleteAccountBtn: "Hesabı sil",
        deleteAccountIntro: "Hesabınızı və bütün məlumatlarınızı 14 günlük təhlükəsizlik müddəti ilə silin.",
      },
      experience: {
        title: "Fərdiləşdirilmiş təcrübə",
        intro: "Brendinizi, sahənizi və cavab üslubunuzu təyin edərək Helmer-in sizin biznesinizə tam uyğunlaşmasını təmin edin.",
        categories: {
          ai: {
            title: "AI İntellekti və Yaddaş",
            desc: "Fərdiləşdirilmiş AI cavabları, strategiyaların avtomatik saxlanılması və daimi yaddaş qeydləri.",
          },
          brand: {
            title: "Brend və Biznes Kimliyi",
            desc: "Şirkət məlumatları, hədəf kütlə və analitik cavab tonu.",
          },
          workspace: {
            title: "İş Mühiti və Görünüş",
            desc: "İlkin açılış rejimi və vizual rəng mövzusu.",
          },
        },
        masterTitle: "Fərdiləşdirilmiş cavablar və strategiyalar",
        masterDesc: "Aktiv olduqda Ask söhbətləri və Build rejimi aşağıdakı brend profili, üslub və yaddaş qeydləri əsasında cavab verir.",
        masterToggleTitle: "Fərdiləşdirilmiş cavablar və strategiyalar",
        masterToggleIntro: "Aktiv olduqda Ask söhbətləri və Build rejimi aşağıdakı brend profili, üslub və yaddaş qeydləri əsasında cavab verir.",
        importTitle: "Yaddaş köçür",
        importDesc: "ChatGPT, Claude və ya Gemini-dakı yaddaşınızı və brend məlumatlarınızı Helmer-ə birbaşa köçürün.",
        importCardTitle: "Yaddaş köçür",
        importCardIntro: "ChatGPT, Claude və ya Gemini-dakı yaddaşınızı və brend məlumatlarınızı Helmer-ə birbaşa köçürün.",
        importBtn: "Yaddaşı köçür",
        profileTitle: "Biznes və brend profili",
        profileDesc: "Hər dəfə şirkətiniz haqqında təkrar məlumat verməmək üçün əsas detalları daxil edin.",
        profileIntro: "Hər dəfə şirkətiniz haqqında təkrar məlumat verməmək üçün əsas detalları daxil edin.",
        brandName: "Brend / Layihə adı",
        brandNamePlaceholder: "Məs: Helmer",
        industry: "Fəaliyyət sahəsi / Sənaye",
        industryPlaceholder: "Məs: B2B SaaS, E-ticarət, Kosmetika",
        primaryMarket: "Əsas bazar / Coğrafiya",
        primaryMarketPlaceholder: "Məs: Azərbaycan (Bakı və regionlar)",
        targetAudience: "Hədəf kütlə",
        targetAudiencePlaceholder: "Məs: 20-35 yaş gənclər, startaplar",
        toneTitle: "AI cavab üslubu və tonu",
        toneDesc: "Cavabların və tərtib olunan strategiyaların hansı tonda təqdim olunmasını seçin.",
        toneIntro: "Cavabların və tərtib olunan strategiyaların hansı tonda təqdim olunmasını seçin.",
        tones: {
          professional: {
            name: "Peşəkar və Analitik",
            desc: "Dəqiq biznes arqumentləri, strukturlaşdırılmış təhlil və rəsmi terminlər.",
          },
          creative: {
            name: "Yaradıcı və Cəsarətli",
            desc: "Fərqli marketinq ideyaları, viral konseptlər və təsirli şüarlar.",
          },
          concise: {
            name: "Qısa və İcra Yönümlü",
            desc: "Girişsiz, birbaşa icra addımları, qısa bəndlər və dərhal tətbiq olunan həllər.",
          },
          friendly: {
            name: "Dostcasına və İzahlı",
            desc: "Səmimi dil, anlaşıqlı yanaşma və marketinq terminlərinin sadə izahı.",
          },
          data_driven: {
            name: "Nəticə və Satış Yönümlü",
            desc: "Dönüşüm (conversion), ROAS, satış qıfı və ölçülə bilən KPI fokuslu.",
          },
        },
        customInstructions: "Xüsusi təlimatlar",
        instructionsTitle: "Xüsusi təlimatlar",
        instructionsDesc: "Helmer-in sizin üçün cavab hazırlayarkən riayət etməli olduğu xüsusi qaydalar.",
        customTitle: "Xüsusi təlimatlar",
        customIntro: "Helmer-in sizin üçün cavab hazırlayarkən riayət etməli olduğu xüsusi qaydalar.",
        customLabel: "Təlimat mətni",
        customPlaceholder: "Məsələn: Təkliflərdə həmişə büdcəyə qənaətcil rəqəmsal kanalları önə çək. Cavablarda addım-addım icra planı və ölçülə bilən KPI cədvəli təqdim et...",
        memoryTitle: "Memory Hub",
        memoryDesc: "Helmer-in biznesiniz haqqında yadda saxladığı məlumatları idarə edin.",
        memoryIntro: "Helmer-in biznesiniz haqqında yadda saxladığı məlumatları idarə edin.",
        memoryBadge: "{count} qeyd",
        memoryFilters: {
          all: "Hamısı",
          preference: "Üstünlüklər",
          constraint: "Məhdudiyyətlər",
          business: "Biznes faktları",
        },
        memoryCategories: {
          business: "Biznes faktı",
          audience: "Auditoriya",
          preference: "Üstünlük",
          constraint: "Məhdudiyyət",
          general: "Qeyd",
        },
        memoryEmpty: "Hələ heç bir yaddaş qeydi saxlanılmayıb.",
        memoryEmptyCategory: "Bu kateqoriyada yaddaş qeydi yoxdur.",
        newMemoryTitle: "Yeni yaddaş qeydi",
        newMemoryHint: "Model üçün qısa və konkret saxlayın",
        newMemoryPlaceholder: "Yeni fakt əlavə et... məs. Biz yalnız B2B şirkətlərlə işləyirik",
        saveMemoryBtn: "Yaddaşı saxla",
        addMemoryActionBtn: "+ Yaddaş əlavə et",
        importInlineBtn: "Başqa AI-dan köçür",
        clearAllMemoriesBtn: "Bütün yaddaşı təmizlə",
        clearMemoriesConfirm: "Bütün yaddaş qeydlərini silmək istədiyinizdən əminsiniz?",
        scopesTitle: "Tətbiq rejimləri",
        scopesDesc: "Fərdiləşdirmənin hansı modullarda işləməsini tənzimləyin.",
        scopesIntro: "Fərdiləşdirmənin hansı modullarda işləməsini tənzimləyin.",
        scopeAskTitle: "Ask",
        scopeAskDesc: "Cari sualınızla bağlı olduqda keçmiş söhbətlər və strategiyalardan faydalı məlumatlar avtomatik cəlb edilir.",
        scopeBuildTitle: "Build",
        scopeBuildDesc: "Yeni strategiya yaradarkən və dəqiqləşdirərkən yuxarıdakı brend profili və ton nəzərə alınır.",
        scopeAutoSaveTitle: "Build Arxivləmə",
        scopeAutoSaveDesc: "Build rejimində hazırlanan strategiyaları avtomatik olaraq arxivə köçürür və saxlayır.",
        autoSaveTitle: "Strategiyaların Avtomatik Saxlanılması (Build)",
        autoSaveDesc: "Build rejimində hazırlanan strategiyaların avtomatik olaraq arxivə köçürülməsini tənzimləyin.",
        autoSaveToggleTitle: "Arxivə Avtomatik Saxlama",
        autoSaveToggleDesc: "Build rejimində generasiya edilən hər yeni strategiya tamamlandıqda birbaşa arxivə əlavə edilsin.",
        autoSaveActive: "Aktiv",
        autoSaveInactive: "Deaktiv",
        autoSaveToastActive: "Build rejimində avtomatik arxivləmə aktiv edildi.",
        autoSaveToastInactive: "Build rejimində avtomatik arxivləmə deaktiv edildi.",
        plannerNotifTitle: "Planlaşdırılanlar Xatırlatmaları",
        plannerNotifDesc: "İş mühitinə daxil olduqda icra gözləyən prioritet və təcili tapşırıqlar barədə xatırlatma al.",
        plannerNotifToggleTitle: "Prioritet Tapşırıq Bildirişləri",
        plannerNotifToggleDesc: "Sayta hər dəfə daxil olduqda icra gözləyən prioritet tapşırıqlar barədə bildiriş göstərilsin.",
        defaultModeTitle: "İlkin açılış rejimi",
        defaultModeDesc: "Helmer açıldıqda hansı rejimdə başlamasını seçin.",
        defaultModeIntro: "Helmer açıldıqda hansı rejimdə başlamasını seçin.",
        saveBtn: "Dəyişiklikləri saxla",
        modes: {
          build: {
            name: "Build",
            desc: "Helmer açıldıqda birbaşa strukturlaşdırılmış strategiya hazırlamaq rejimini aktiv edin.",
          },
          ask: {
            name: "Ask",
            desc: "Helmer açıldıqda birbaşa AI ilə interaktiv söhbət və operativ sual-cavab rejimini aktiv edin.",
          },
        },
      },
      security: {
        title: "Giriş təhlükəsizliyi",
        intro: "Hesab şifrənizi və aktiv sessiyalarınızı idarə edin.",
        currentPassword: "Cari şifrə",
        newPassword: "Yeni şifrə",
        confirmPassword: "Yeni şifrəni təkrarla",
        updatePasswordBtn: "Şifrəni yenilə",
        changePasswordBtn: "Şifrəni yenilə",
        updatingPassword: "Yenilənir…",
        passwordUpdatedToast: "Şifrəniz uğurla yeniləndi.",
        signOutTitle: "Bu cihazdan çıx",
        signOutDesc: "Helmer sessiyanı təhlükəsiz şəkildə bağlayacaq.",
        signOutBtn: "Çıxış et",
        logoutBtn: "Çıxış et",
        deleteAccountTitle: "Hesabı sil",
        deleteAccountDesc: "Hesabınızı və bütün məlumatlarınızı 14 günlük təhlükəsizlik müddəti ilə silin.",
        deleteAccountBtn: "Hesabı sil",
        modelImprovementTitle: "Modelin inkişafına töhfə",
        modelImprovementDesc: "Süni intellekt modellərinin və sistemin inkişafına töhfə verin. Fərdiləşdirmə söndürüldükdə bu seçim də söndürülür.",
        modelImprovementInfoBtn: "Ətraflı məlumat",
        modelImprovementInfoDetails: "Aktivləşdirmək üçün fərdiləşdirmə açıq olmalıdır. Bu seçimi söndürdükdə fərdiləşdirmə açıq qala bilər, lakin yeni qarşılıqlı əlaqələrin məzmunu model inkişafına daxil edilmir; yalnız zəruri əməliyyat məlumatları saxlanılır.",
        modelImprovementDeactivatedToast: "Modelin inkişafına töhfə deaktivləşdirildi.",
        modelImprovementActivatedToast: "Modelin inkişafına töhfə aktivləşdirildi.",
      },
      legal: {
        title: "Hüquqi məlumatlar və məxfilik",
        intro: "İstifadə qaydaları, məxfilik prinsipləri və əlaqə vasitələri.",
        termsTitle: "İstifadə şərtləri",
        termsDesc: "Platformadan istifadə qaydaları, hüquq və vəzifələr.",
        privacyTitle: "Məxfilik siyasəti",
        privacyDesc: "Məlumatların toplanması, emalı və qorunması prinsipləri.",
        reportTitle: "Problem və ya hüquqi bildiriş göndər",
        reportDesc: "Sistem cavablarında müəllif hüququ, qeyri-etik məzmun və ya texniki nasazlıq gördükdə bizə bildirin.",
        viewTerms: "İstifadə şərtlərini oxu",
        viewPrivacy: "Məxfilik siyasətini oxu",
        reportIssueTitle: "Problem və ya hüquqi bildiriş göndər",
        reportIssueIntro: "Sistem cavablarında müəllif hüququ, qeyri-etik məzmun və ya texniki nasazlıq gördükdə bizə bildirin.",
        issueType: "Problem növü",
        issueTypeSelect: "Problem növünü seçin",
        issueTypes: {
          copyright: "Müəllif hüquqları və əqli mülkiyyət pozuntusu",
          privacy: "Fərdi məlumatlar və məxfilik pozuntusu",
          harmful: "Zərərli, qeyri-etik və ya aldadıcı məzmun",
          incorrect: "Faktiki ciddi səhv və ya dezinformasiya",
          other: "Digər hüquqi və ya texniki problem",
        },
        issueDesc: "Problemin ətraflı təsviri",
        issueDescPlaceholder: "Problemi və rast gəldiyiniz vəziyyəti ətraflı izah edin...",
        issueEmail: "Əlaqə e-poçtunuz (istəyə bağlı)",
        submitReportBtn: "Bildirişi göndər",
        submittingReport: "Göndərilir…",
        reportSuccessToast: "Müraciətiniz qeydə alındı. Təşəkkür edirik!",
      },
    },

    // ── Authentication Screens ───────────────────────────────────────────────
    auth: {
      login: {
        title: "Daxil ol",
        subtitle: "İşlərinizi və yadda saxlanılan strategiyalarınızı idarə edin.",
        identifierLabel: "E-poçt və ya istifadəçi adı",
        passwordLabel: "Şifrə",
        forgotPasswordLink: "Şifrəni unutmusan?",
        submitBtn: "Daxil ol",
        submitting: "Daxil olunur…",
        googleBtn: "Google ilə daxil ol",
        noAccountPrompt: "Hesabın yoxdur?",
        signupLink: "Qeydiyyatdan keç",
      },
      signup: {
        stepBadge: "Addım 1 / 3 · Hesab məlumatları",
        title: "Hesab yarat",
        subtitle: "Pulsuz başlayın. Strategiyalarınızı istənilən cihazdan idarə edin.",
        fullNameLabel: "Ad və soyad",
        usernameLabel: "İstifadəçi adı",
        emailLabel: "E-poçt",
        passwordLabel: "Şifrə",
        passwordRequirements: "Ən azı 10 simvol, hərf və rəqəm daxil olmalıdır.",
        submitBtn: "Qeydiyyatdan keç",
        submitting: "Hesab yaradılır…",
        googleBtn: "Google ilə qeydiyyat",
        hasAccountPrompt: "Artıq hesabın var?",
        loginLink: "Daxil ol",
        termsAgreementPre: "Davam etməklə Helmer-in ",
        termsLink: "istifadə şərtlərini",
        and: " və ",
        privacyLink: "məxfilik siyasətini",
        termsAgreementPost: " qəbul edirsən.",
      },
      onboarding: {
        stepBadge: "Addım 2 / 3 · Fərdiləşdirmə",
        welcomeTitle: "Salam, {name}",
        subtitle: "Helmer-i iş axınınıza uyğunlaşdırmaq üçün qısa məlumat verin.",
        roleLabel: "Rol və ya fəaliyyət sahəniz:",
        roles: {
          marketing: { title: "Marketinq", desc: "Rəqəmsal marketinq, brend və böyümə" },
          startup: { title: "Startap / Təsisçi", desc: "Məhsul inkişafı və bazar açılışı" },
          business: { title: "Biznes İdarəetmə", desc: "Rəhbərlik, əməliyyatlar və strategiya" },
          ecommerce: { title: "E-ticarət", desc: "Onlayn mağaza, satış və pərakəndə" },
          freelance: { title: "Freelance", desc: "Müstəqil mütəxəssis və ya agentlik" },
          other: { title: "Digər", desc: "Fərqli fəaliyyət sahəsi və ya layihə" },
        },
        goalLabel: "Əsas istifadə məqsədiniz:",
        goals: {
          strategy: { title: "Strategiya qurmaq", desc: "Bazar analizi, mövqelənmə və yol xəritəsi" },
          content: { title: "Məzmun yaratmaq", desc: "Kampaniya konsepsiyaları və kreativ mesajlar" },
          execution: { title: "İcra və analiz", desc: "Tapşırıqların icrası, KPI və nəticələrin analizi" },
        },
        continueBtn: "Davam et",
        skipBtn: "Keç",
        submitting: "Yadda saxlanılır…",
      },
      overview: {
        stepBadge: "Addım 3 / 3 · Workspace İcmalı",
        title: "Helmer Workspace-ə xoş gəldiniz",
        subtitle: "Strateji idarəetmə, süni intellektlə icra və güclü iş axını bir məkanda.",
        cards: {
          strategy: {
            title: "Strateji İdarəetmə",
            desc: "Dəqiq biznes hədəfləri, bazar analizi, rəqib araşdırması və addım-addım böyümə yol xəritələri.",
          },
          execution: {
            title: "Süni İntellektlə İcra",
            desc: "Dərin süni intellekt kopiloti, avtomatlaşdırılmış kampaniyalar və sürətli kreativ məzmun.",
          },
          workflow: {
            title: "Vahid İş Axını",
            desc: "Tapşırıq planlayıcısı, PDF/DOCX sənəd ixracı və real-vaxt performans nəticələri.",
          },
        },
        enterBtn: "Workspace-ə daxil ol",
      },
      forgotPassword: {
        title: "Şifrənin bərpası",
        subtitle: "E-poçt ünvanınızı daxil edin. Şifrəni sıfırlamaq üçün keçid göndərəcəyik.",
        emailLabel: "E-poçt ünvanı",
        submitBtn: "Bərpa linki göndər",
        submitting: "Göndərilir…",
        backToLogin: "Giriş səhifəsinə qayıt",
        sentNotice: "Əgər bu e-poçtla hesab varsa, bərpa linki göndərildi. Gələnlər qutusunu yoxlayın.",
      },
      resetPassword: {
        title: "Yeni şifrə təyin et",
        subtitle: "Hesabınız üçün yeni təhlükəsiz şifrə daxil edin.",
        newPasswordLabel: "Yeni şifrə",
        confirmPasswordLabel: "Yeni şifrənin təkrarı",
        submitBtn: "Şifrəni yenilə",
        submitting: "Yenilənir…",
        successNotice: "Şifrəniz uğurla yeniləndi. İndi yeni şifrənizlə daxil ola bilərsiniz.",
      },
      verifyEmail: {
        title: "E-poçtu təsdiqləyin",
        subtitle: "{email} ünvanına göndərilən 6 rəqəmli təsdiq kodunu daxil edin.",
        codeLabel: "6 rəqəmli təsdiq kodu",
        submitBtn: "Təsdiqlə",
        submitting: "Təsdiqlənir…",
        resendBtn: "Kodu yenidən göndər",
        resendSuccess: "Təsdiq kodu yenidən göndərildi.",
      },
      migration: {
        prompt: "Bu brauzerdəki {count} strategiya hesabınıza köçürülsün?",
        confirmBtn: "Köçür və daxil ol",
        skipBtn: "Köçürmədən davam et",
      },
    },

    // ── Delete Account Modal ─────────────────────────────────────────────────
    deleteAccountModal: {
      title: "Hesabın silinməsini təsdiqləyirsiniz?",
      subtitle: "14 günlük təhlükəsizlik və gözləmə müddəti",
      closeAria: "Bağla",
      callout: "Hesabınız dərhal silinmir. 14 günlük təhlükəsiz gözləmə müddəti tətbiq olunur.",
      rule1Title: "Dərhal deaktivasiya:",
      rule1Desc: "Təsdiq etdiyiniz an cari sessiyanız bağlanacaq və hesabınız təhlükəsiz gözləmə rejiminə keçəcək.",
      rule2Title: "14 gün ərzində avtomatik bərpa:",
      rule2Desc: "14 gün ərzində fikrinizi dəyişsəniz, sadəcə hesabınıza yenidən daxil olmaqla silinməni ləğv edə və hesabınızı tam bərpa edə bilərsiniz.",
      rule3Title: "14 gündən sonra tam silinmə:",
      rule3Desc: "14 gün ərzində daxil olmasanız, bütün strategiyalarınız, söhbətləriniz və fərdi məlumatlarınız bazadan həmişəlik silinəcək.",
      confirmInputLabel: 'Təsdiq üçün "SIL" və ya "DELETE" yazın:',
      confirmInputPlaceholder: "SIL və ya DELETE",
      confirmBtn: "Hesabı deaktiv et və silməyə qoy",
      canceling: "Ləğv edilir…",
      cancelBtn: "İmtina et",
    },

    // ── Common UI / Toasts / Errors ──────────────────────────────────────────
    common: {
      disclaimer: "Helmer səhv edə bilər.",
      save: "Yadda saxla",
      cancel: "Ləğv et",
      delete: "Sil",
      edit: "Redaktə et",
      close: "Bağla",
      copy: "Kopyala",
      copied: "Kopyalandı",
      loading: "Yüklənir…",
      success: "Uğurlu əməliyyat",
      error: "Xəta baş verdi",
      retry: "Yenidən cəhd et",
      back: "Geri",
      continue: "Davam et",
      all: "Hamısı",
      search: "Axtar",
      filter: "Filtr",
      sort: "Sırala",
      actions: "Əməliyyatlar",
      notAvailable: "Mövcud deyil",
      genericError: "Sorğunu tamamlamaq mümkün olmadı. Zəhmət olmasa bir az sonra yenidən cəhd edin.",
      networkError: "İnternet bağlantınızı yoxlayın.",
      sessionExpired: "Sessiyanız bitmişdir. Zəhmət olmasa yenidən daxil olun.",
    },

    // ── Date & Time Format Units ─────────────────────────────────────────────
    time: {
      justNow: "indi",
      minutesAgo: "{count} dəq əvvəl",
      hoursAgo: "{count} saat əvvəl",
      yesterday: "dünən",
      daysAgo: "{count} gün əvvəl",
    },

    // ── Install App (PWA) Modal ──────────────────────────────────────────────
    installModal: {
      title: "Helmer tətbiqini quraşdırın",
      subtitle: "Daha sürətli daxilolma və tam ekran təcrübəsi üçün Helmer-i cihazınıza əlavə edin.",
      installedTitle: "Tətbiq artıq aktivdir",
      installedSubtitle: "Helmer artıq cihazınızda quraşdırılıb.",
      installedSuccess: "Tətbiq uğurla quraşdırıldı ✓",
      alreadyInstalledToast: "Tətbiq artıq cihazınızda aktivdir ✓",
      closeAria: "Pəncərəni bağla",
      understandBtn: "Anladım",
      iosBadge: "iOS (Safari)",
      iosStep1Title: "Paylaş menyusuna toxunun",
      iosStep1Desc: "Safari-nin aşağı panelindəki 'Paylaş' (kvadratdan yuxarı ox çıxan) ikonuna toxunun.",
      iosStep2Title: "'Ana ekrana əlavə et' seçin",
      iosStep2Desc: "Aşağı sürüşdürərək 'Ana ekrana əlavə et' (+) bəndini tapın.",
      iosStep3Title: "'Əlavə et' düyməsini sıxın",
      iosStep3Desc: "Yuxarı sağ küncdəki 'Əlavə et' düyməsinə klikləyərək tamamlayın.",
      androidBadge: "Android & Chromium",
      androidStep1Title: "Brauzer menyusunu açın",
      androidStep1Desc: "Yuxarı sağdakı brauzer menyusuna (üç nöqtə ⋮) klikləyin.",
      androidStep2Title: "'Tətbiqi quraşdırın' seçin",
      androidStep2Desc: "'Tətbiqi quraşdırın' və ya 'Ana ekrana əlavə edin' seçimini tapın.",
      androidStep3Title: "Quraşdırmanı təsdiqləyin",
      androidStep3Desc: "Açılan pəncərədə 'Quraşdır' düyməsini sıxaraq təsdiqləyin.",
      desktopBadge: "Masaüstü (Desktop)",
      desktopStep1Title: "Ünvan sətrinə baxın",
      desktopStep1Desc: "Brauzerin yuxarı ünvan sətrindəki (URL bar) 'Quraşdır' ikonuna klikləyin.",
      desktopStep2Title: "'Quraşdır' seçimini edin",
      desktopStep2Desc: "'Helmer tətbiqini quraşdırın' sorğusunu təsdiqləyin.",
      desktopStep3Title: "Tətbiqdən zövq alın",
      desktopStep3Desc: "Helmer ayrıca müstəqil masaüstü tətbiqi pəncərəsində açılacaqdır.",
    },

    // ── Helmer 4 Release Card ──────────────────────────────────────────────
    announcement: {
      title: "Helmer 4 istifadənizdədir",
      body: "Yüksək təhlükəsizlik standartlarına cavab verən tamamilə yenilənmiş müasir təməl arxitektura, yeni funksiyalar və daha çoxu. Ətraflı Yeniliklər bölməsində.",
      dontShow: "Bir daha göstərmə",
      cta: "Anladım",
      closeAria: "Bağla",
    },

    // ── Limit Policy Notice (24.10.2026) ───────────────────────────────────
    limitPolicyNotice: {
      body: "24.10.2026-cı il tarixindən etibarən Helmer-də limit siyasətinə dəyişiklik etdik. Bildirmək istəyirik ki, bu dəyişiklik yalnız qeydiyyatsız istifadəçilər üçün nəzərdə tutulmuşdur və qeydiyyatlı hesablarda limitlər dəyişilməz olaraq saxlanılıb. Anlayışınıza görə təşəkkür edirik!",
      closeBtn: "Bağla",
      closeAria: "Bağla",
    },

    // ── Changelog / What's New ────────────────────────────────────────────────
    changelog: {
      title: "Yeniliklər",
      subtitle: "Helmer-in inkişaf və təkamül xronologiyası",
      closeAria: "Yeniliklər pəncərəsini bağla",
      currentBadge: "Cari versiya",
      historyBadge: "Əvvəlki buraxılış",
      feedbackBtn: "Rəy bildir",
      feedbackSubject: "Helmer Rəyi və Təklifi",
      versions: [
        {
          version: "v4.0",
          name: "Helmer v4.0",
          subtitle: "Yüksək təhlükəsizlik standartlarına cavab verən yeni müasir təməl arxitektura",
          status: "Cari versiya",
          date: "Oktyabr 2026",
          isCurrent: true,
          isUpcoming: false,
          highlights: [
            "Yüksək təhlükəsizlik standartlarına cavab verən yeni müasir təməl arxitektura: Zero-trust modeli, ciddi tenant izolasiyası, worker thread sandbox mühiti və qorunan sistem bütövlüyü.",
            "HelmerUp gamification biznes məşqləri: Praktiki biznes sualları və ssenariləri, cavablandırma ilə xal (XP) qazanılması, streak izlənməsi və interaktiv bacarıq inkişafı.",
            "Ask rejimində Deep Research: Build rejiminin tam ekvivalenti olan dərin analitik araşdırma mühərriki, ultra-sürətli çıxış generasiyası və strukturlaşdırılmış bazar icmalı.",
            "Ask daxilində tamhüquqlu fayl və sənəd generasiyası: Birbaşa sistem daxilində peşəkar Word (.docx), Excel (.xlsx), PDF və PowerPoint (.pptx) fayllarının hazırlanması və ixracı.",
            "Build rejimində Search Grounding: Canlı veb axtarış inteqrasiyası ilə real bazar məlumatlarına, rəqib analitikasına və ən son faktlara əsaslanan dəqiq strateji çıxışlar.",
            "Modellərin yüksək çıxış keyfiyyəti və ciddi təlimatlar: Analitik dəqiqliyi, icra detallarını və strateji dərinliyi maksimum dərəcədə artıran sərtləşdirilmiş sistem təlimatları.",
            "Çoxmodeli kollektiv icra: Tək bir sorğu üzərində bir neçə ixtisaslaşmış intellektual modelin eyni vaxtda koordinasiyalı və sinxron çalışması.",
          ],
        },
        {
          version: "v3.5",
          name: "Helmer v3.5",
          subtitle: "Dərin Kalibrasiya & Yerli Bazar Mühərriki",
          status: "Buraxılış",
          date: "Sentyabr 2026",
          isCurrent: false,
          isUpcoming: false,
          highlights: [
            "Dərin model kalibrasiyası: Epistemic humility, faktiki dəqiqlik, hallüsinasiya risklərinin minimuma endirilməsi və canlı web search grounding.",
            "Context-Aware Azerbaijan Market Engine: Yerli istehlakçı psixologiyası, ödənişlər, B2C/B2B kanalları və bazar reallıqları üzrə adaptasiya.",
            "İnterfeys təkmilləşdirmələri: UI/UX cilalanması, sistem sabitliyi və qarşılıqlı əlaqə xətalarının aradan qaldırılması.",
          ],
        },
        {
          version: "v3.0",
          name: "Helmer v3.0",
          subtitle: "Avtonom Planlama & Çoxmərhələli İş Axınları",
          status: "Buraxılış",
          date: "Avqust 2026",
          isCurrent: false,
          highlights: [
            "Avtonom iş axınları: Çoxmərhələli iş axınları və dərindən strukturlaşdırılmış icra planlaması.",
          ],
        },
        {
          version: "v2.0",
          name: "Helmer v2.0",
          subtitle: "Avtonom İş Rejimi & Dinamik Strategiya",
          status: "Buraxılış",
          date: "Noyabr 2025",
          isCurrent: false,
          highlights: [
            "Avtonom iş rejiminə keçid və dinamik strategiya generasiyası.",
          ],
        },
        {
          version: "v1.0",
          name: "Helmer v1.0",
          subtitle: "Təməl Arxitektura & MVP",
          status: "MVP",
          date: "Dekabr 2024",
          isCurrent: false,
          highlights: [
            "İlkin təməl arxitektura və platformanın ilkin MVP buraxılışı.",
          ],
        },
      ],
    },

    starterGuide: {
      buildCardTitle: "Build rejimi",
      buildCardSubtitle: "Strategiya necə qurulur?",
      buildCardBadge: "Yol xəritəsi",
      askCardTitle: "Ask rejimi",
      askCardSubtitle: "Sual və analiz necə edilir?",
      askCardBadge: "Canlı məsləhət",
      ariaRegion: "Başlanğıc bələdçisi kartları",
      buildCardAria: "Build rejimi başlanğıc bələdçisini aç",
      askCardAria: "Ask rejimi başlanğıc bələdçisini aç",
      modalTitleBuild: "Build Rejimi: Necə başlamalı?",
      modalTitleAsk: "Ask Rejimi: Necə başlamalı?",
      tabBuild: "Build rejimi",
      tabAsk: "Ask rejimi",
      principleHeading: "İş prinsipi",
      buildPrinciple: "Helmer sizin biznes ideyanızı, startap layihənizi və ya inkişaf hədəfinizi dərin bazar analizi, rəqabət üstünlükləri, maliyyə və marketinq addımları ilə zənginləşdirilmiş icra oluna bilən tam strategiyaya çevirir. Yaradılan strategiyanı Word (.docx), Excel (.xlsx), PowerPoint (.pptx) və PDF sənədləri kimi ixrac edə və ya addımları birbaşa Planner lövhəsinə tapşırıq olaraq əlavə edə bilərsiniz.",
      askPrinciple: "Ask rejimi sizin 7/24 fəaliyyət göstərən strateji biznes məsləhətçinizdir. Canlı Google axtarışı (Grounding) ilə internetdən ən son faktiki məlumatları toplayır, sənədlərinizi və şəkillərinizi (PDF, Excel, Word, şəkillər) təhlil edir, arxivinizdəki strategiyalar və ya Planner tapşırıqları kontekstində dəqiq, əsaslandırılmış cavablar təqdim edir.",
      stepsHeading: "3 sadə addımla başla",
      buildStep1Title: "1. İdeyanı və ya məqsədini yaz",
      buildStep1Desc: "Nə etmək istədiyini 1-2 cümlə ilə qeyd et (məs: «Bakıda B2B qəhvə çatdırılması xidməti açmaq istəyirəm») və ya '+' düyməsi ilə hazır şablon seç.",
      buildStep2Title: "2. Dəqiqləşdirici sualları cavabla",
      buildStep2Desc: "Helmer ehtiyac olduqda büdcə, hədəf kütlə və coğrafiya haqqında qısa suallar verərək strategiyanı dəqiqləşdirəcək.",
      buildStep3Title: "3. Strategiyanı əldə et və icra et",
      buildStep3Desc: "Bir neçə dəqiqəyə bazar təhlili, SWOT və fəaliyyət planın hazır olacaq. Sənədləri yüklə və ya Planner-də icraya başla.",
      askStep1Title: "1. Sualını ver və ya fayl əlavə et",
      askStep1Desc: "Biznes, maliyyə, marketinq və ya əməliyyatla bağlı istənilən sualı yaz və ya sənəd/cədvəl yükləyərək təhlil istə.",
      askStep2Title: "2. Kontekst əlaqələndir ('+' menyusu)",
      askStep2Desc: "Daha hədəfli cavab üçün arxivdəki strategiyanı və ya Planner tapşırığını seçərək sualını həmin kontekstə bağla.",
      askStep3Title: "3. Düşünmə səviyyəsini seç",
      askStep3Desc: "Mürəkkəb strateji qərarlar və dərin təhlil üçün 'High' düşünmə səviyyəsini aktivləşdirərək əsaslandırılmış arqumentlər əldə et.",
      examplesHeading: "Nümunə sorğular",
      buildExample1: "B2B SaaS məhsulu üçün 6 aylıq bazara çıxış (Go-to-market) strategiyası",
      buildExample2: "Bakıda premium qəhvə çatdırılması startapı üçün icra planı və rəqib analizi",
      buildExample3: "Yerli geyim brendi üçün satışları 2 dəfə artıracaq marketinq strategiyası",
      askExample1: "Müştəri qazanma dəyərini (CAC) keyfiyyət itirmədən necə 25% azalda bilərik?",
      askExample2: "Dominant rəqiblərlə qiymət müharibəsinə girmədən necə fərqlənə bilərik?",
      askExample3: "Startap üçün toxum (seed) investisiya təqdimatında hansı metriklər vacibdir?",
      btnStartBuild: "Build rejimində başla",
      btnStartAsk: "Ask rejimində başla",
      modalCloseAria: "Bağla",
      dismissAria: "Bir daha göstərmə",
    },
  },

  en: {
    // ── Global & Brand ────────────────────────────────────────────────────────
    brand: {
      name: "Helmer",
      tagline: "Transform business goals into execution-ready marketing strategies.",
      workspaceName: "Helmer",
      personalAccount: "Personal Account",
      guestAccount: "Guest Workspace",
      homeAriaLabel: "Helmer Homepage",
    },

    // ── Navigation & Rail ─────────────────────────────────────────────────────
    nav: {
      skipToMain: "Skip to main content",
      menu: "Menu",
      openMenu: "Open workspace menu",
      closeMenu: "Close menu",
      home: "Home",
      askChat: "Chat",
      archive: "Archive",
      planner: "Planner",
      up: "Helmer UP",
      comingSoon: "Coming soon",
      limits: "Usage",
      installApp: "Install App",
      whatsNew: "What's new",
      settings: "Settings",
      search: "Search",
      searchChats: "Search",
      searchPlaceholder: "Search...",
      newStrategy: "New Strategy",
      newChat: "New Chat",
      recentWork: "Recent Work",
      chatHistory: "Chat History",
      recentWorkEmptyTitle: "No strategies yet",
      recentWorkEmptySubtitle: "Your saved strategies and roadmaps will appear here.",
      recentChatsEmptyTitle: "No conversations yet",
      recentChatsEmptySubtitle: "Your conversation history will appear here.",
      modeSwitchAria: "Workspace mode",
      modeBuild: "Build",
      modeAsk: "Ask",
      switchToAsk: "Switch to Ask mode",
      switchToBuild: "Switch to Build mode",
      modeTooltipBuildToAsk: "Switch to Ask Chat (⌘K)",
      modeTooltipAskToBuild: "Switch to Strategy Builder (⌘K)",
      quickNavAria: "Quick Navigation",
      mainNavAria: "Main navigation",
      workspaceAria: "Workspace",
      shortcuts: "Shortcuts",
      terms: "Terms of Service",
      privacy: "Privacy Policy",
      languageToggle: "Azərbaycan dili (AZ)",
      languageToggleAria: "Switch interface language to Azerbaijani",
      themeToggleDark: "Switch to Dark Mode",
      themeToggleLight: "Switch to Light Mode",
      accountSettings: "Account Settings",
      openAccountSettings: "Open account settings",
    },

    // ── User Profile Menu ──────────────────────────────────────────────────
    profileMenu: {
      ariaLabel: "User profile menu",
      personalization: "Personalization",
      profile: "Profile",
      settings: "Settings",
      security: "Security",
      legal: "Legal",
      help: "Help",
      logout: "Log out",
      planFree: "Free Plan",
      planPro: "Pro Plan",
      planPersonal: "Personal",
      planGuest: "Guest Plan",
      guestUser: "Guest",
    },

    // ── Support Chat Bubble ────────────────────────────────────────────────
    supportBubble: {
      greeting: "Hi {name}, need help?",
      greetingGuest: "Hi, need help?",
      ariaLabel: "Support & Contact",
      popoverTitle: "Help & Support",
      popoverSubtitle: "Get in touch with us for questions or feedback.",
      emailOptionLabel: "Send an email",
      copyEmail: "Copy email",
      copied: "Copied!",
      close: "Close",
    },

    // ── Keyboard Shortcuts ───────────────────────────────────────────────────
    shortcuts: {
      title: "Keyboard Shortcuts",
      subtitle: "Quick navigation and actions for {platform}",
      closeAria: "Close keyboard shortcuts window",
      hint: "Shortcuts are accessible globally across the workspace. Press ⌘/ or ? anytime.",
      or: "or",
      items: {
        newStrategyOrChat: "New strategy or chat",
        home: "Home",
        archive: "Archive",
        planner: "Planner",
        settings: "Settings",
        modeToggle: "Toggle between Build and Ask modes",
        toggleMode: "Toggle between Build and Ask modes",
        closeModal: "Close dialog or modal",
      },
    },

    // ── Build Intake (Home) ──────────────────────────────────────────────────
    intake: {
      kicker: "STRATEGY BUILDER",
      title: "Turn your business goal into an execution strategy.",
      subtitle: "Describe your product or goal. Helmer identifies strategic gaps and crafts an execution-ready roadmap.",
      placeholder: "e.g. Launching a B2B SaaS analytics tool for e-commerce brands in North America. Need a 6-month go-to-market plan, acquisition channels, and KPI targets...",
      submitButton: "Build Strategy",
      submitThinking: "Thinking…",
      submitAnalyzing: "Analyzing…",
      attachFile: "Attach File",
      attachFileTooltip: "PDF, Word, TXT, MD (up to 10MB)",
      removeFile: "Remove file",
      suggestionsTitle: "Starter Templates",
      fileTooLarge: "File size exceeds 10MB limit.",
      fileInvalidType: "Supported file formats: PDF, DOCX, TXT, and Markdown.",
      errorEmptyPrompt: "Please describe your business goal or project to continue.",
    },

    // ── Clarification ────────────────────────────────────────────────────────
    clarification: {
      kicker: "STRATEGY CLARIFICATION",
      title: "A few quick questions to sharpen your strategy",
      subtitle: "We analyzed your brief. Answering these targeted questions will ensure a tailored, execution-ready strategy.",
      questionCounter: "Question {current} of {total}",
      skipQuestion: "Skip question",
      skipAll: "Skip and build strategy",
      nextButton: "Next Question",
      finishButton: "Generate Strategy",
      textPlaceholder: "Type your answer or provide additional context...",
      customOptionPlaceholder: "Write your own answer...",
      optionOther: "Other option",
      generatingStrategy: "Generating your strategy…",
    },

    // ── Loading Screen ───────────────────────────────────────────────────────
    loading: {
      title: "Generating your marketing strategy",
      subtitle: "Synthesizing market context, strategic positioning, and channel execution roadmap.",
      bgJobNote: "You can safely navigate away — generation continues in the background and saves to your Archive.",
      tips: [
        "Analyzing business model and competitive landscape…",
        "Refining ideal customer profile and positioning…",
        "Optimizing acquisition channels and budget allocation…",
        "Structuring phased 30-60-90 day execution roadmap…",
        "Defining measurable KPIs, metrics, and risk mitigations…",
        "Finalizing strategic documentation…",
      ],
    },

    // ── Strategy Workspace ───────────────────────────────────────────────────
    strategy: {
      titlePlaceholder: "Strategy Title",
      versionBadge: "v{version}",
      versionTooltip: "Version history",
      statusDraft: "Draft",
      statusSaved: "Saved",
      statusSaving: "Saving…",
      statusDirty: "Unsaved changes",
      copyLink: "Copy link",
      linkCopied: "Link copied to clipboard",
      duplicate: "Duplicate",
      duplicatedToast: "Strategy duplicated successfully.",
      exportMenu: "Export",
      exportPdf: "Download PDF",
      exportDocx: "Download Word (.docx)",
      exportXls: "Download Excel (.xls)",
      exportCsv: "Export CSV",
      exportMarkdown: "Copy Markdown",
      markdownCopied: "Markdown copied to clipboard.",
      pdfGenerating: "Generating PDF…",
      sections: {
        priorities: "01. Strategic Priorities",
        positioning: "02. Positioning & Market Fit",
        actionPlan: "03. Execution Roadmap",
        kpis: "04. KPIs & Success Metrics",
        risks: "05. Risks & Mitigations",
        nextSteps: "06. Immediate Next Steps",
      },
      badges: {
        priority: "Priority",
        phase: "Phase {number}",
        target: "Target:",
        expectedOutcome: "Expected Outcome:",
        risk: "Risk",
        mitigation: "Mitigation:",
        timeGroupToday: "Today",
        timeGroup48h: "Next 48 Hours",
        timeGroupWeek: "This Week",
      },
      actions: {
        addToPlanner: "Add to Planner",
        addedToPlanner: "Added",
        addAllToPlanner: "Add all steps to Planner",
        askAiAboutStrategy: "Ask AI about this strategy",
        refineStrategy: "Refine Strategy",
      },
      refinement: {
        title: "Refine Strategy",
        subtitle: "Choose a strategic refinement goal or provide custom instructions.",
        options: {
          shorten: "Make it more concise",
          localize_azerbaijan: "Localize for Azerbaijan market",
          think_deeper: "Deep Strategic Analysis",
          make_practical: "Focus on actionable execution",
          budget_optimize: "Optimize budget & channels",
          custom: "Custom refinement",
        },
        customPlaceholder: "Describe what you would like to adjust, expand, or refine...",
        submitButton: "Apply Refinement",
        applying: "Refining strategy…",
      },
      askDrawer: {
        title: "Strategy Copilot",
        subtitle: "Ask questions about specific execution milestones, channels, budgets, or risks.",
        placeholder: "Ask anything about this strategy...",
        send: "Send",
      },
      summary: {
        button: "Summary",
        buttonAria: "Show strategy summary",
        title: "Strategy Summary",
        badge: "Executive Brief",
        objectiveTitle: "Objective & Focus",
        movesTitle: "Critical Strategic Moves",
        executionTitle: "Execution Direction",
        kpiTitle: "Budget & KPIs",
        takeawayTitle: "Executive Takeaway",
        copy: "Copy summary",
        copied: "Copied!",
        close: "Close",
        loading: "Generating strategy summary…",
        error: "Could not generate summary. Please try again.",
        retry: "Retry",
      },
    },

    // ── Ask Workspace (Chat) ─────────────────────────────────────────────────
    ask: {
      kicker: "AI ADVISOR",
      title: "Strategic Marketing Copilot",
      subtitle: "Explore marketing channels, test campaign ideas, analyze competitors, and model unit economics.",
      modelSelectorLabel: "Model:",
      modelAuto: "Auto",
      modelFlash: "Gemini 3.8 Flash",
      thinkingToggle: "Deep Reasoning",
      searchToggle: "Web Search",
      newChat: "New Chat",
      clearChatConfirm: "Start a new conversation? Your current chat will remain saved in Archive.",
      placeholder: "Ask a marketing question, analyze a competitor, or paste a link... (Enter to send)",
      send: "Send",
      stop: "Stop",
      attachFile: "Attach File",
      attachFileTooltip: "PDF, Word, TXT, Images (up to 20MB)",
      thinkingProcess: "Reasoning Process",
      hideThinking: "Hide reasoning",
      showThinking: "Show reasoning",
      sources: "Sources ({count})",
      webSearchBadge: "Google Search",
      copyMessage: "Copy",
      messageCopied: "Copied to clipboard",
      regenerate: "Regenerate",
      addToPlanner: "Add to Planner",
      reportMessage: "Report Issue",
      suggestedQuestions: "Recommended Prompts",
      exportChat: "Export Chat",
      deleteChatConfirm: "Permanently delete this conversation? This cannot be undone.",
      contextSheet: {
        title: "Add context",
        files: "Files",
        filesDesc: "PDF & documents",
        photos: "Images / Camera",
        photosDesc: "For visual analysis",
        strategies: "My Strategies",
        strategiesDesc: "Add a saved strategy to context",
        tasks: "Planner Tasks",
        tasksDesc: "Select an active task as context",
        deepResearch: "Deep Research",
        deepResearchDesc: "Market & competitor analysis report",
        promptTemplates: "Prompt Templates",
        promptTemplatesDesc: "Starter prompt templates",
        personalIntelligence: "Personal Intelligence",
        personalIntelligenceDesc: "Personalization in chat context",
        personalIntelligenceOn: "Active",
        personalIntelligenceOff: "Disabled",
        clearContext: "Clear context",
        back: "Back",
        emptyStrategies: "Archive is currently empty.",
        emptyTasks: "No active tasks in Planner.",
      },
      contextActions: {
        ariaToolbar: "Context quick actions",
        analyze: "Analyze",
        analyzePrompt: "Analyze this strategy in detail: identify core strengths, weaknesses, critical risks, and highest-impact growth opportunities.",
        prosAndCons: "Explore pros & cons",
        prosAndConsPrompt: "Critically evaluate the pros and cons of this strategy, highlighting potential pitfalls, trade-offs, and alternative approaches.",
        roadmap: "Build execution roadmap",
        roadmapPrompt: "Create a step-by-step execution roadmap for this strategy: include phased milestones, timeline, and key performance indicators.",
        bottlenecks: "Find bottlenecks & risks",
        bottlenecksPrompt: "Stress-test this strategy to uncover potential execution bottlenecks, resource constraints, and strategic risks.",
        taskPlan: "Create action plan",
        taskPlanPrompt: "Provide a concrete step-by-step action plan and best practices to execute this task efficiently.",
        taskBlockers: "Identify blockers & risks",
        taskBlockersPrompt: "Identify potential blockers and risks during the execution of this task, along with mitigation strategies.",
        taskEffort: "Effort & timeline",
        taskEffortPrompt: "Structure the estimated effort, required resources, and clear success criteria for completing this task.",
        taskSteps: "Immediate steps",
        taskStepsPrompt: "List the first 3 highest-priority, immediate action items to get started on this task right away.",
      },
      modelSheet: {
        title: "Select Model",
        autoTitle: "Auto",
        autoDesc: "Automatic routing",
        newBadge: "New",
        flashTitle: "Flash",
        flashDesc: "For daily workflows, search & fast replies",
        thinkingTitle: "Thinking mode",
        thinkingOn: "Deep analysis active",
        thinkingOff: "Fast direct response",
      },
    },

    // ── Archive ──────────────────────────────────────────────────────────────
    archive: {
      kicker: "WORK HISTORY",
      title: "Archive",
      subtitle: "All your generated marketing strategies and AI advisory conversations.",
      searchPlaceholder: "Search by title, brief, or keyword...",
      filterAll: "All",
      filterStrategies: "Strategies",
      filterChats: "Chats",
      sortRecent: "Most Recent",
      sortAlpha: "Alphabetical",
      sortOldest: "Oldest",
      updatedAt: "Updated: {date}",
      versionsCount: "{count} versions",
      messagesCount: "{count} messages",
      emptyAllTitle: "No saved items yet",
      emptyAllSubtitle: "Your generated strategies and conversations will appear here automatically.",
      emptyFilterTitle: "No matching results",
      emptyFilterSubtitle: "Try adjusting your search terms or selecting a different filter.",
      deleteConfirmTitle: "Delete Strategy",
      deleteConfirmBody: 'Are you sure you want to delete "{title}"? This action cannot be undone.',
      cancel: "Cancel",
      delete: "Delete",
      deletedToast: "Deleted successfully.",
      open: "Open",
      bgCtaTag: "Time-saver",
      bgCtaTitle: "Short on time? Let Helmer handle it on the generation page!",
      bgCtaDesc: "No need to wait while your strategy generates — select “Continue in background”. The process runs smoothly in the background and your finished roadmap is saved straight to your Archive.",
      bgCtaAction: "New strategy",
      bgCtaDismiss: "Dismiss",
      buildSomethingNew: "Build something new",
      viewAll: "View all",
      recentStrategies: "Recent strategies",
      noStrategiesYet: "No strategies yet",
      researchTipTitle: "Want to wait less next time?",
      researchTipDesc: "Try the new Deep Research feature in Ask mode! Get the synthesis of speed with comparable performance.",
      researchTipAction: "Try it",
      researchTipTag: "Deep Research",
      researchTipDismiss: "Dismiss",
    },

    // ── Planner ──────────────────────────────────────────────────────────────
    planner: {
      kicker: "EXECUTION TRACKER",
      title: "Planner",
      subtitle: "Actionable milestones compiled from your marketing strategies and discussions.",
      filterAll: "All ({count})",
      filterActive: "Active ({count})",
      filterCompleted: "Completed ({count})",
      inputPlaceholder: "Add an execution task... (Press Enter to save)",
      groupSelectGeneral: "General",
      addButton: "Add Task",
      emptyTitle: "No tasks scheduled",
      emptySubtitle: "Add execution items from your strategies or chats to track progress here.",
      taskCompletedToast: "Task marked as completed.",
      taskReopenedToast: "Task marked as active.",
      taskDeletedToast: "Task deleted.",
      deleteTaskAria: "Delete task",
      addToPlannerBtn: "✦ AI Summarize & Add",
      addAllManualBtn: "Add All As Is",
      summarizingWithAi: "✦ Summarizing with AI…",
      modalBadge: "✦ AI Summary",
      modalBadgeRaw: "Original Tasks",
      modalTitle: "Add to Planner",
      modalSubtitle: "Actionable tasks summarized and optimized by AI.",
      modalSubtitleRaw: "Original execution action items from the strategy.",
      tabAiSummary: "✦ AI Summary",
      tabOriginal: "As-Is (Original)",
      selectAll: "Select All",
      deselectAll: "Deselect All",
      selectedCount: "{selected} of {total} selected",
      addSelectedBtn: "Add Selected ({count})",
      cancelBtn: "Cancel",
      singleAdded: "Added",
      singleAdd: "Add to Planner",
      toastSingleAdded: "1 task added to Planner ✓",
      toastBulkAdded: "{count} tasks added to Planner ✓",
      toastManualAdded: "{count} tasks added to Planner ✓",
      executeTask: "Execute",
      generateRoadmap: "Prepare execution map",
      tasksSelected: "{count} tasks selected",
      filterPriority: "Priority",
      priorityNewBadge: "New",
      priorityModelBadge: "Separated by AI",
      priorityBannerTitle: "Priorities classified by AI",
      priorityBannerSubtitle: "High-leverage tasks isolated for immediate breakthrough and execution.",
      reprioritizeWithLuna: "Re-prioritize",
      prioritizingWithLuna: "Analyzing and separating tasks...",
      prioritizeSuccess: "Separated {count} priority tasks ✓",
      noPriorityTasks: "No priority tasks yet",
      noPriorityDesc: "Run the AI model to automatically isolate your high-impact strategic tasks.",
      prioritizeBtn: "Prioritize tasks",
      markPriority: "Mark as priority",
      unmarkPriority: "Remove from priority",
      notifications: "Notifications",
      notificationsTooltip: "Planner notifications",
      notifGreeting: "Hello, {name}! You still have pending priority task(s) in Planner waiting for execution. Don't forget to review them.",
      notifWindowSubtitle: "Pending priority tasks",
      notifRemindLater: "Remind me later",
      notifReviewTasks: "Review tasks",
      notifDeactivate: "Deactivate",
      notifRemindersActive: "Reminders active",
      notifAllCaughtUp: "All caught up",
      notifAllCaughtUpDesc: "No pending priority tasks waiting for execution ✓",
      notifSnoozedToast: "Reminder snoozed for 2 hours",
      notifDisabledToast: "Planner notifications disabled",
      notifEnabledToast: "Planner notifications enabled",
      notifDueBadge: "Urgent",
      taskHelpfulQuestion: "Was this task helpful?",
      taskHelpfulYes: "Helpful",
      taskHelpfulNo: "Not helpful",
      taskFeedbackRecorded: "Feedback recorded ✓",
    },


    // ── Limits & Usage ───────────────────────────────────────────────────────
    limits: {
      kicker: "USAGE & LIMITS",
      title: "Usage & Limits",
      subtitle: "Monitor your workspace activity and tier allowances.",
      periodToday: "Today",
      periodMonth: "This Month",
      periodAllTime: "All Time",
      buildUsageTitle: "Strategy Builder",
      buildUsageSubtitle: "Generated & refined strategies",
      askUsageTitle: "Strategic Copilot",
      askUsageSubtitle: "AI queries & research sessions",
      contextUsageTitle: "Knowledge Hub",
      contextUsageSubtitle: "Persisted brand facts & memory",
      resetNotice: "Daily quotas reset at 00:00 UTC.",
      featureBreakdownTitle: "Included Features",
      features: {
        buildGen: "Full-funnel marketing strategy generation",
        askQueries: "Real-time competitive research & strategic advisor",
        exportFormats: "Export to PDF, Word (DOCX), Excel (XLS), and CSV",
        webSearch: "Live market data & grounded Google Web Search",
        memoryHub: "Memory Hub & personalized brand context",
        unlimitedStorage: "Cloud storage for all strategies and conversation history",
      },
    },

    // ── Settings ─────────────────────────────────────────────────────────────
    settings: {
      kicker: "WORKSPACE",
      title: "Settings",
      subtitle: "Manage your account, brand intelligence, and security preferences.",
      guestTitle: "Save Your Progress",
      guestSubtitle: "You can use Helmer as a guest. Creating a free account syncs your strategies across all devices.",
      guestPanelTitle: "Account is Optional",
      guestPanelIntro: "Your work is currently saved locally in this browser. Create a free account to access it anywhere.",
      guestSignupBtn: "Create Free Account",
      guestLoginBtn: "Sign In",
      tabs: {
        account: "Account",
        experience: "Personalization",
        security: "Security",
        legal: "Legal & Privacy",
      },
      languageSelector: {
        title: "Interface Language",
        intro: "Choose your preferred language for Helmer.",
        az: "Azərbaycan dili",
        en: "English",
        toastChanged: "Interface language updated.",
      },
      account: {
        title: "Account Details",
        intro: "Update your profile information and credentials.",
        fullName: "Full Name",
        username: "Username",
        email: "Email",
        saveBtn: "Save Changes",
        saving: "Saving…",
        successToast: "Account details updated successfully.",
        dangerZoneTitle: "Danger Zone",
        deleteAccountBtn: "Delete Account",
        deleteAccountIntro: "Permanently delete your account and workspace data with a 14-day recovery window.",
      },
      experience: {
        title: "Personalized Intelligence",
        intro: "Define your brand identity, market positioning, and response style so Helmer tailors every recommendation to your business.",
        categories: {
          ai: {
            title: "AI Intelligence & Memory",
            desc: "Tailored AI responses, strategy auto-save, and persistent strategic memories.",
          },
          brand: {
            title: "Brand & Business Identity",
            desc: "Company facts, target market audience, and analytical response tone.",
          },
          workspace: {
            title: "Workspace & Interface",
            desc: "Default launch workspace and surface appearance tone.",
          },
        },
        masterTitle: "Personalized AI Intelligence",
        masterDesc: "When enabled, Helmer tailors strategies and responses to your brand profile, voice tone, and stored memories.",
        masterToggleTitle: "Personalized AI Intelligence",
        masterToggleIntro: "When enabled, Helmer tailors strategies and responses to your brand profile, voice tone, and stored memories.",
        importTitle: "Import Knowledge & Memory",
        importDesc: "Import brand knowledge and strategic context from other AI assistants directly into Helmer.",
        importCardTitle: "Import Knowledge & Memory",
        importCardIntro: "Import brand knowledge and strategic context from other AI assistants directly into Helmer.",
        importBtn: "Import Memory",
        profileTitle: "Business & Brand Profile",
        profileDesc: "Enter core business details so you never have to repeat context in future prompts.",
        profileIntro: "Enter core business details so you never have to repeat context in future prompts.",
        brandName: "Brand / Company Name",
        brandNamePlaceholder: "e.g. Helmer",
        industry: "Industry / Vertical",
        industryPlaceholder: "e.g. B2B SaaS, E-commerce, FinTech",
        primaryMarket: "Primary Market / Geography",
        primaryMarketPlaceholder: "e.g. North America, Global, Azerbaijan",
        targetAudience: "Target Audience",
        targetAudiencePlaceholder: "e.g. Startup founders, Growth marketers, Enterprise leads",
        toneTitle: "AI Persona & Voice",
        toneDesc: "Choose the communication voice and analytical depth for generated strategies and answers.",
        toneIntro: "Choose the communication voice and analytical depth for generated strategies and answers.",
        tones: {
          professional: {
            name: "Executive & Analytical",
            desc: "Structured business logic, data-backed frameworks, and formal strategic terminology.",
          },
          creative: {
            name: "Creative & Bold",
            desc: "Unconventional marketing angles, high-impact hooks, and innovative campaign concepts.",
          },
          concise: {
            name: "Concise & Action-Oriented",
            desc: "Zero fluff, direct bullet points, rapid execution milestones, and immediate takeaways.",
          },
          friendly: {
            name: "Collaborative & Instructive",
            desc: "Approachable tone, step-by-step guidance, and accessible explanations of marketing principles.",
          },
          data_driven: {
            name: "Performance & Conversion-Driven",
            desc: "Focused on conversion rates, ROAS, CAC/LTV economics, and measurable revenue impact.",
          },
        },
        customInstructions: "Custom Instructions",
        instructionsTitle: "Custom Instructions",
        instructionsDesc: "Specific directives and strategic rules Helmer must follow in all responses.",
        customTitle: "Custom Instructions",
        customIntro: "Specific rules and instructions Helmer should follow when drafting responses for you.",
        customLabel: "Instruction Text",
        customPlaceholder: "e.g. Always prioritize cost-effective organic channels and provide actionable KPI tables with step-by-step 30-60-90 day milestones...",
        memoryTitle: "Memory Hub",
        memoryDesc: "Manage persistent business facts and strategic preferences stored across your workspace.",
        memoryIntro: "Manage verified business facts and strategic preferences Helmer remembers about your business.",
        memoryBadge: "{count} items",
        memoryFilters: {
          all: "All",
          preference: "Preferences",
          constraint: "Constraints",
          business: "Business Facts",
        },
        memoryCategories: {
          business: "Business Fact",
          audience: "Target Audience",
          preference: "Preference",
          constraint: "Constraint",
          general: "Note",
        },
        memoryEmpty: "No memory items saved yet.",
        memoryEmptyCategory: "No memory items in this category.",
        newMemoryTitle: "New Memory Item",
        newMemoryHint: "Keep it concise and factual for best AI accuracy",
        newMemoryPlaceholder: "Add a fact... e.g. We sell exclusively to B2B enterprise software clients",
        saveMemoryBtn: "Save Memory",
        addMemoryActionBtn: "+ Add Memory",
        importInlineBtn: "Import from Another AI",
        clearAllMemoriesBtn: "Clear All Memory",
        clearMemoriesConfirm: "Are you sure you want to delete all saved memory items?",
        scopesTitle: "Activation Scopes",
        scopesDesc: "Configure which modules actively reference your personalized context and memory.",
        scopesIntro: "Control which modules utilize your personalized context.",
        scopeAskTitle: "Ask Copilot",
        scopeAskDesc: "Automatically retrieves relevant context from past chats and strategies when answering questions.",
        scopeBuildTitle: "Strategy Builder",
        scopeBuildDesc: "Applies your brand profile and tone when creating and refining strategies.",
        scopeAutoSaveTitle: "Build Auto-Save",
        scopeAutoSaveDesc: "Automatically saves and archives strategies generated in Build mode.",
        autoSaveTitle: "Strategy Auto-Save (Build Mode)",
        autoSaveDesc: "Configure whether strategies created in Build mode are automatically saved to your archive.",
        autoSaveToggleTitle: "Auto-Save to Archive",
        autoSaveToggleDesc: "Automatically preserve newly generated strategies in your workspace archive upon completion.",
        autoSaveActive: "Active",
        autoSaveInactive: "Inactive",
        autoSaveToastActive: "Strategy auto-save enabled.",
        autoSaveToastInactive: "Strategy auto-save disabled.",
        plannerNotifTitle: "Planner Priority Reminders",
        plannerNotifDesc: "Receive reminders about pending priority and urgent tasks when opening the workspace.",
        plannerNotifToggleTitle: "Priority Task Notifications",
        plannerNotifToggleDesc: "Display reminders about pending priority tasks each time you open the workspace.",
        defaultModeTitle: "Default Workspace View",
        defaultModeDesc: "Select whether Helmer opens in Strategy Builder or Ask mode by default.",
        defaultModeIntro: "Choose which mode activates when you open Helmer.",
        saveBtn: "Save Changes",
        modes: {
          build: {
            name: "Strategy Builder",
            desc: "Start directly in the structured strategy builder workspace.",
          },
          ask: {
            name: "Strategic Copilot",
            desc: "Start directly in the interactive AI advisor and chat workspace.",
          },
        },
      },
      security: {
        title: "Sign-in & Security",
        intro: "Manage your password and active login sessions.",
        currentPassword: "Current Password",
        newPassword: "New Password",
        confirmPassword: "Confirm New Password",
        updatePasswordBtn: "Update Password",
        changePasswordBtn: "Update Password",
        updatingPassword: "Updating…",
        passwordUpdatedToast: "Password updated successfully.",
        signOutTitle: "Sign Out",
        signOutDesc: "Safely terminate your current session on this device.",
        signOutBtn: "Sign Out",
        logoutBtn: "Log Out",
        deleteAccountTitle: "Delete Account",
        deleteAccountDesc: "Permanently delete your account and associated workspace data with a 14-day recovery period.",
        deleteAccountBtn: "Delete Account",
        modelImprovementTitle: "Contribute to model improvement",
        modelImprovementDesc: "Contribute to the improvement of AI models and the system. Turning personalization off also turns this option off.",
        modelImprovementInfoBtn: "More information",
        modelImprovementInfoDetails: "Personalization must be on to enable this option. Turning this option off allows personalization to stay on, but excludes new interaction content from model improvement; only necessary operational data is retained.",
        modelImprovementDeactivatedToast: "Contribution to model improvement deactivated.",
        modelImprovementActivatedToast: "Contribution to model improvement enabled.",
      },
      legal: {
        title: "Legal & Privacy",
        intro: "Terms of service, privacy practices, and compliance reporting.",
        termsTitle: "Terms of Service",
        termsDesc: "Platform terms, user responsibilities, and intellectual property rights.",
        privacyTitle: "Privacy Policy",
        privacyDesc: "Data collection, processing practices, and security principles.",
        reportTitle: "Report an Issue or Notice",
        reportDesc: "Submit a report regarding copyright, privacy concerns, or unexpected behavior.",
        viewTerms: "Read Terms of Service",
        viewPrivacy: "Read Privacy Policy",
        reportIssueTitle: "Report an Issue / Legal Notice",
        reportIssueIntro: "Report copyright concerns, sensitive content, or system inaccuracies.",
        issueType: "Issue Category",
        issueTypeSelect: "Select issue category",
        issueTypes: {
          copyright: "Copyright or intellectual property infringement",
          privacy: "Personal data or privacy violation",
          harmful: "Harmful, unethical, or misleading content",
          incorrect: "Critical factual inaccuracy or misinformation",
          other: "Other legal or technical issue",
        },
        issueDesc: "Detailed Description",
        issueDescPlaceholder: "Describe the issue and where you encountered it...",
        issueEmail: "Contact Email (optional)",
        submitReportBtn: "Submit Report",
        submittingReport: "Submitting…",
        reportSuccessToast: "Your report has been submitted. Thank you for helping keep Helmer safe.",
      },
    },

    // ── Authentication Screens ───────────────────────────────────────────────
    auth: {
      login: {
        title: "Sign In",
        subtitle: "Access your workspace and saved strategies.",
        identifierLabel: "Email or username",
        passwordLabel: "Password",
        forgotPasswordLink: "Forgot password?",
        submitBtn: "Sign In",
        submitting: "Signing in…",
        googleBtn: "Sign in with Google",
        noAccountPrompt: "Don't have an account?",
        signupLink: "Create account",
      },
      signup: {
        stepBadge: "Step 1 of 3 · Account Details",
        title: "Create Account",
        subtitle: "Start for free. Manage your marketing strategies from any device.",
        fullNameLabel: "Full Name",
        usernameLabel: "Username",
        emailLabel: "Email",
        passwordLabel: "Password",
        passwordRequirements: "At least 10 characters, including letters and numbers.",
        submitBtn: "Create Account",
        submitting: "Creating account…",
        googleBtn: "Sign up with Google",
        hasAccountPrompt: "Already have an account?",
        loginLink: "Sign in",
        termsAgreementPre: "By continuing, you agree to Helmer's ",
        termsLink: "Terms of Service",
        and: " and ",
        privacyLink: "Privacy Policy",
        termsAgreementPost: ".",
      },
      onboarding: {
        stepBadge: "Step 2 of 3 · Personalization",
        welcomeTitle: "Welcome, {name}",
        subtitle: "Briefly customize Helmer for your specific workflow.",
        roleLabel: "Your role or field:",
        roles: {
          marketing: { title: "Marketing", desc: "Digital marketing, brand & growth" },
          startup: { title: "Startup / Founder", desc: "Product development & go-to-market" },
          business: { title: "Business Management", desc: "Leadership, operations & strategy" },
          ecommerce: { title: "E-Commerce", desc: "Online store, retail & direct sales" },
          freelance: { title: "Freelance", desc: "Independent consultant or agency" },
          other: { title: "Other", desc: "Other custom domain or project" },
        },
        goalLabel: "Primary purpose / goal:",
        goals: {
          strategy: { title: "Build Strategy", desc: "Market analysis, positioning & roadmap" },
          content: { title: "Create Content", desc: "Campaign concepts & creative messaging" },
          execution: { title: "Execution & Analytics", desc: "Task execution, KPIs & performance tracking" },
        },
        continueBtn: "Continue",
        skipBtn: "Skip",
        submitting: "Saving…",
      },
      overview: {
        stepBadge: "Step 3 of 3 · Workspace Overview",
        title: "Welcome to Helmer Workspace",
        subtitle: "Strategic management, AI execution, and unified workflows in one place.",
        cards: {
          strategy: {
            title: "Strategic Management",
            desc: "Clear business objectives, market research, competitive insights, and step-by-step growth roadmaps.",
          },
          execution: {
            title: "AI-Powered Execution",
            desc: "AI-powered deep copilot for rapid campaign concepts, creative copy, and execution.",
          },
          workflow: {
            title: "Unified Workflows",
            desc: "Built-in task planner, instant PDF/DOCX exports, and real-time performance tracking.",
          },
        },
        enterBtn: "Enter Workspace",
      },
      forgotPassword: {
        title: "Reset Password",
        subtitle: "Enter your email address and we will send you a reset link.",
        emailLabel: "Email address",
        submitBtn: "Send Reset Link",
        submitting: "Sending…",
        backToLogin: "Back to sign in",
        sentNotice: "If an account exists for this email, a reset link has been sent. Please check your inbox.",
      },
      resetPassword: {
        title: "Set New Password",
        subtitle: "Enter a strong new password for your account.",
        newPasswordLabel: "New Password",
        confirmPasswordLabel: "Confirm New Password",
        submitBtn: "Update Password",
        submitting: "Updating…",
        successNotice: "Your password has been updated. You can now sign in with your new password.",
      },
      verifyEmail: {
        title: "Verify Your Email",
        subtitle: "Enter the 6-digit verification code sent to {email}.",
        codeLabel: "6-digit verification code",
        submitBtn: "Verify Code",
        submitting: "Verifying…",
        resendBtn: "Resend code",
        resendSuccess: "Verification code resent.",
      },
      migration: {
        prompt: "Transfer {count} strategies from this browser to your account?",
        confirmBtn: "Transfer & Continue",
        skipBtn: "Continue without transferring",
      },
    },

    // ── Delete Account Modal ─────────────────────────────────────────────────
    deleteAccountModal: {
      title: "Confirm Account Deletion",
      subtitle: "14-Day Recovery Window",
      closeAria: "Close",
      callout: "Your account is not permanently erased immediately. A 14-day recovery window is provided.",
      rule1Title: "Immediate Access Revocation:",
      rule1Desc: "Your active session ends immediately and your account enters protected deactivation status.",
      rule2Title: "Effortless 14-Day Restoration:",
      rule2Desc: "Changed your mind? Simply sign in within 14 days to cancel deletion and restore all workspace data.",
      rule3Title: "Permanent Data Erasure:",
      rule3Desc: "After 14 days without login, all strategies, conversations, and account records will be permanently deleted.",
      confirmInputLabel: 'Type "DELETE" or "SIL" to confirm:',
      confirmInputPlaceholder: "DELETE or SIL",
      confirmBtn: "Deactivate & Schedule Deletion",
      canceling: "Canceling…",
      cancelBtn: "Cancel",
    },

    // ── Common UI / Toasts / Errors ──────────────────────────────────────────
    common: {
      disclaimer: "Helmer may produce inaccurate information. Verify important strategic decisions.",
      save: "Save",
      cancel: "Cancel",
      delete: "Delete",
      edit: "Edit",
      close: "Close",
      copy: "Copy",
      copied: "Copied",
      loading: "Loading…",
      success: "Success",
      error: "An error occurred",
      retry: "Retry",
      back: "Back",
      continue: "Continue",
      all: "All",
      search: "Search",
      filter: "Filter",
      sort: "Sort",
      actions: "Actions",
      notAvailable: "N/A",
      genericError: "Unable to complete request. Please try again in a moment.",
      networkError: "Please check your internet connection.",
      sessionExpired: "Your session has expired. Please sign in again.",
    },

    // ── Date & Time Format Units ─────────────────────────────────────────────
    time: {
      justNow: "just now",
      minutesAgo: "{count}m ago",
      hoursAgo: "{count}h ago",
      yesterday: "yesterday",
      daysAgo: "{count}d ago",
    },

    // ── Install App (PWA) Modal ──────────────────────────────────────────────
    installModal: {
      title: "Install Helmer App",
      subtitle: "Add Helmer to your device for instant access and a full-screen app experience.",
      installedTitle: "App Already Installed",
      installedSubtitle: "Helmer is already running on your device.",
      installedSuccess: "App installed successfully ✓",
      alreadyInstalledToast: "App is already installed on your device ✓",
      closeAria: "Close dialog",
      understandBtn: "Got it",
      iosBadge: "iOS (Safari)",
      iosStep1Title: "Tap the Share button",
      iosStep1Desc: "Tap the 'Share' icon (square with upward arrow) in Safari's bottom toolbar.",
      iosStep2Title: "Select 'Add to Home Screen'",
      iosStep2Desc: "Scroll down and tap 'Add to Home Screen' (+).",
      iosStep3Title: "Confirm by tapping 'Add'",
      iosStep3Desc: "Tap 'Add' in the top-right corner to complete installation.",
      androidBadge: "Android & Chromium",
      androidStep1Title: "Open browser menu",
      androidStep1Desc: "Tap the three dots (⋮) menu in the top right corner of your browser.",
      androidStep2Title: "Select 'Install app'",
      androidStep2Desc: "Tap 'Install app' or 'Add to Home screen'.",
      androidStep3Title: "Confirm installation",
      androidStep3Desc: "Tap 'Install' on the confirmation prompt to add Helmer.",
      desktopBadge: "Desktop",
      desktopStep1Title: "Look at the address bar",
      desktopStep1Desc: "Click the 'Install' icon located on the right side of the address bar.",
      desktopStep2Title: "Click 'Install'",
      desktopStep2Desc: "Confirm the prompt to install Helmer on your computer.",
      desktopStep3Title: "Launch Helmer",
      desktopStep3Desc: "Helmer will open in its own distraction-free app window.",
    },

    // ── Helmer 4 Release Card ──────────────────────────────────────────────
    announcement: {
      title: "Helmer 4 is now available",
      body: "Completely revamped modern foundational architecture meeting high security standards, new features, and much more. Details in the What's new section.",
      dontShow: "Don't show again",
      cta: "Got it",
      closeAria: "Close",
    },

    // ── Limit Policy Notice (24.10.2026) ───────────────────────────────────
    limitPolicyNotice: {
      body: "Effective October 24, 2026, we have updated the limit policy in Helmer. Please note that this change applies only to unregistered users, while limits for registered accounts remain unchanged. Thank you for your understanding!",
      closeBtn: "Close",
      closeAria: "Close",
    },

    // ── Changelog / What's New ────────────────────────────────────────────────
    changelog: {
      title: "What's new",
      subtitle: "Helmer's evolution and release chronology",
      closeAria: "Close What's new dialog",
      currentBadge: "Current Version",
      historyBadge: "Previous Release",
      feedbackBtn: "Send Feedback",
      feedbackSubject: "Helmer Feedback & Suggestions",
      versions: [
        {
          version: "v4.0",
          name: "Helmer v4.0",
          subtitle: "Modern foundational architecture meeting high security standards",
          status: "Current Version",
          date: "October 2026",
          isCurrent: true,
          isUpcoming: false,
          highlights: [
            "Modern foundational architecture meeting high security standards: Zero-trust architecture, strict tenant isolation, worker thread sandboxing, and immutable system integrity.",
            "HelmerUp gamified business workouts: Practical business challenges and scenarios, score & points (XP) rewards upon answering, daily streak tracking, and interactive skill building.",
            "Ask Deep Research: Full equivalent of Build mode deep research engine delivering ultra-fast output and comprehensive market intelligence.",
            "Direct document generation in Ask: High-fidelity creation and export of Word (.docx), Excel (.xlsx), PDF, and PowerPoint (.pptx) documents directly inside Ask mode.",
            "Search Grounding in Build mode: Real-time web search integration grounding strategies in live market data, competitive intelligence, and verified facts.",
            "Enhanced model output quality & strict instruction tuning: Rigorous system prompts and calibration maximizing analytical depth, factual rigor, and actionable granularity.",
            "Multi-model collaborative execution: Seamless orchestration where multiple specialized intelligence models collaborate concurrently on a single query.",
          ],
        },
        {
          version: "v3.5",
          name: "Helmer v3.5",
          subtitle: "Deep Calibration & Local Market Engine",
          status: "Release",
          date: "September 2026",
          isCurrent: false,
          isUpcoming: false,
          highlights: [
            "Deep model calibration: Epistemic humility, factual accuracy, minimized hallucination risk, and grounded live web search retrieval.",
            "Context-Aware Azerbaijan Market Engine: Local consumer psychology, payment rails, B2C/B2B channels, and market realities.",
            "Interface enhancements: UI/UX refinement, system stabilization, and interaction polish.",
          ],
        },
        {
          version: "v3.0",
          name: "Helmer v3.0",
          subtitle: "Autonomous Planning & Multi-step Workflows",
          status: "Release",
          date: "August 2026",
          isCurrent: false,
          highlights: [
            "Autonomous workflows: Multi-step workflows and deeply structured execution planning.",
          ],
        },
        {
          version: "v2.0",
          name: "Helmer v2.0",
          subtitle: "Autonomous Mode & Dynamic Strategy",
          status: "Release",
          date: "November 2025",
          isCurrent: false,
          highlights: [
            "Transition to autonomous execution mode and dynamic strategy generation.",
          ],
        },
        {
          version: "v1.0",
          name: "Helmer v1.0",
          subtitle: "Foundational Architecture & MVP",
          status: "MVP",
          date: "December 2024",
          isCurrent: false,
          highlights: [
            "Foundational architecture and initial MVP platform launch.",
          ],
        },
      ],
    },

    starterGuide: {
      buildCardTitle: "Build mode",
      buildCardSubtitle: "How to build a strategy?",
      buildCardBadge: "Roadmap",
      askCardTitle: "Ask mode",
      askCardSubtitle: "How to ask & research?",
      askCardBadge: "Live consult",
      ariaRegion: "Getting started guide cards",
      buildCardAria: "Open Build mode getting started guide",
      askCardAria: "Open Ask mode getting started guide",
      modalTitleBuild: "Build Mode: How to get started?",
      modalTitleAsk: "Ask Mode: How to get started?",
      tabBuild: "Build mode",
      tabAsk: "Ask mode",
      principleHeading: "Working principle",
      buildPrinciple: "Helmer transforms your business idea, startup, or market objective into an end-to-end executable roadmap enriched with competitor intelligence, SWOT, Unique Value Proposition (UVP), and financial projections. You can export the generated strategy directly to Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF, or push action items into your Planner board.",
      askPrinciple: "Ask mode is your 24/7 strategic business consultant. Powered by live Google Search Grounding, it retrieves real-time facts from the web, analyzes uploaded documents and spreadsheets (PDF, Excel, Word, images), and answers questions in the direct context of your saved strategies or Planner tasks.",
      stepsHeading: "Get started in 3 simple steps",
      buildStep1Title: "1. Describe your goal or idea",
      buildStep1Desc: "Outline your project in 1-2 sentences (e.g. «I want to launch a B2B coffee delivery service») or select a ready-made template via the '+' menu.",
      buildStep2Title: "2. Answer clarifying questions",
      buildStep2Desc: "If necessary, Helmer asks targeted follow-ups about target audience, budget, or geography to refine the strategic direction.",
      buildStep3Title: "3. Review & execute your strategy",
      buildStep3Desc: "Within moments, your market analysis, SWOT, and action roadmap are ready. Export files or begin execution in Planner.",
      askStep1Title: "1. Ask a question or attach files",
      askStep1Desc: "Submit any question on business, marketing, finance, or operations, or upload documents and spreadsheets for comprehensive analysis.",
      askStep2Title: "2. Link context ('+' menu)",
      askStep2Desc: "For pinpoint accuracy, attach an existing strategy or Planner task so answers build on your actual business history.",
      askStep3Title: "3. Choose thinking depth",
      askStep3Desc: "Enable 'High' thinking for complex strategic dilemmas, multi-angle trade-offs, and deep analytical reasoning.",
      examplesHeading: "Starter examples",
      buildExample1: "6-month go-to-market strategy for a B2B SaaS product",
      buildExample2: "Execution roadmap & competitor analysis for a premium coffee delivery startup",
      buildExample3: "Omnichannel marketing strategy to double retail clothing sales",
      askExample1: "How can we reduce customer acquisition cost (CAC) by 25% without sacrificing quality?",
      askExample2: "How to differentiate from dominant competitors without engaging in price wars?",
      askExample3: "What key metrics must be highlighted in an early-stage seed pitch deck?",
      btnStartBuild: "Start in Build mode",
      btnStartAsk: "Start in Ask mode",
      modalCloseAria: "Close",
      dismissAria: "Don't show again",
    },
  },
};

/**
 * Legal documents in Azerbaijani and English.
 */
export const LEGAL_DOCS_I18N = {
  az: {
    terms: {
      title: "İstifadə Şərtləri",
      subtitle: "Helmer Strategy OS platformasının istifadə qaydaları və hüquqi şərtləri",
      html: `
        <table class="legal-table">
          <thead>
            <tr>
              <th>Sənəd Rekvizitləri</th>
              <th>Təfsilat</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Qüvvəyə minmə tarixi</strong></td>
              <td>3 oktyabr 2026</td>
            </tr>
            <tr>
              <td><strong>Xidmət operatoru</strong></td>
              <td>Innova Group Azerbaijan</td>
            </tr>
            <tr>
              <td><strong>Rəsmi internet informasiya ehtiyatı</strong></td>
              <td><a href="https://helmeros.com">helmeros.com</a></td>
            </tr>
            <tr>
              <td><strong>Hüquqi və texniki əlaqə ünvanı</strong></td>
              <td><a href="mailto:support@helmeros.com">support@helmeros.com</a></td>
            </tr>
          </tbody>
        </table>

        <div class="legal-highlight-box">
          <strong>✦ Preambula və Süni İntellekt İnfrastrukturu</strong>
          <p>Helmer Strategy OS platforması analitik tədqiqatların aparılması, biznes strategiyalarının modelləşdirilməsi, bazar araşdırmaları və strukturlaşdırılmış analitik məlumatların hasil edilməsi məqsədilə süni intellekt alqoritmlərindən, böyük dil modellərindən (LLM), tətbiqi proqramlaşdırma interfeyslərindən (API) və üçüncü tərəf hesablama texnologiyalarından istifadə edir. İstifadə olunan sistem modelləri, texniki provayderlər və arxitektur həllər platformanın əməliyyat zərurətlərinə müvafiq qaydada Innova Group Azerbaijan tərəfindən birtərəfli şəkildə dəyişdirilə və ya yenilənə bilər.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 1. Ümumi Müddəalar və Tərəflərin Razılığı</h3>
          <p>1.1. Bu İstifadə Şərtləri (“Şərtlər”) Innova Group Azerbaijan tərəfindən idarə olunan Helmer Strategy OS platformasına (“Helmer Strategy OS”, “Helmer”, “Platforma”, “Xidmət”) giriş və ondan istifadə qaydalarını, eləcə də tərəflərin hüquq və vəzifələrini tənzimləyir.</p>
          <p>1.2. Platformadan hər hansı formada istifadə edilməsi, o cümlədən hesabın qeydiyyatdan keçirilməsi və ya sistemə sorğuların göndərilməsi istifadəçinin bu Şərtlərlə tam tanış olduğunu, onların hüquqi qüvvəsini anladığını və icrasına dair qeyd-şərtsiz razılıq verdiyini təsdiq edir. Bu Şərtlərlə razılaşmayan şəxslərin Platformadan istifadə hüququ yoxdur.</p>
          <p>1.3. Helmer Strategy OS strateji və biznes təhlillərinə yardımçı xarakterli rəqəmsal proqram təminatı mühitidir.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 2. Yaş Həddi və Hüquqi Fəaliyyət Qabiliyyəti</h3>
          <p>2.1. Azərbaycan Respublikasının Mülki Məcəlləsinin müvafiq tələblərinə uyğun olaraq, Platforma yalnız tam fəaliyyət qabiliyyətli və 18 yaşına çatmış şəxslərin istifadəsi üçün nəzərdə tutulur.</p>
          <p>2.2. Platformadan istifadə edən hər bir şəxs ən azı 18 yaşının tamam olduğunu, müqavilə bağlamaq və öhdəlik götürmək üçün zəruri hüquq və fəaliyyət qabiliyyətinə malik olduğunu rəsmi qaydada bəyan və təsdiq edir.</p>
          <p>2.3. Platformanın 18 yaşına çatmamış şəxslər tərəfindən istifadə edildiyi aşkar edildikdə, Innova Group Azerbaijan xəbərdarlıq etmədən müvafiq hesaba xidmət göstərilməsini dərhal və birtərəfli qaydada dayandırmaq və ya xitam vermək hüququnu özündə saxlayır.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 3. Peşəkar Məsləhətin İstisnası və Etibarlılıq Qadağası (Non-Reliance)</h3>
          <p>3.1. Platforma vasitəsilə təqdim olunan bütün analitik strukturlar, biznes modelləri, bazar təhlilləri, büdcə bölgüləri və fəaliyyət planları sırf yardımçı, konseptual və məlumatlandırıcı xarakter daşıyır.</p>
          <p>3.2. Platformanın fəaliyyəti və təqdim etdiyi nəticələr peşəkar hüquqi, maliyyə, investisiya, vergi və ya lisenziyalaşdırılan digər sahələr üzrə ekspert rəyini əvəz etmir. İstifadəçi ilə Innova Group Azerbaijan arasında heç bir fiduciar, konsaltinq və ya digər peşəkar vəkillik münasibəti formalaşmır.</p>
          <p>3.3. Süni intellekt texnologiyalarının təbiəti etibarilə sistem tərəfindən hasil edilən çıxışların qeyri-dəqiq, natamam, köhnəlmiş və ya təhrif olunmuş faktlar ehtiva etməsi mümkündür (alqoritmik hallusinasiya riski). İstifadəçi Platformanın məlumatlarına əsaslanan hər hansı kommersiya, əməliyyat, maliyyə və ya hüquqi qərar qəbul etməzdən əvvəl həmin məlumatların düzgünlüyünü müstəqil ixtisaslaşmış mütəxəssislər vasitəsilə yoxlamaq məsuliyyətini şəxsən daşıyır.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 4. Əqli Mülkiyyət, Məzmun və Fərdiləşdirmə / Model İnkişafı Asılılığı</h3>
          <p>4.1. <strong>İstifadəçi Məzmunu:</strong> İstifadəçi tərəfindən sistemə daxil edilən fərdi biznes təsvirləri, briflər, təhlil sənədləri və digər materiallar (“İstifadəçi Məzmunu”) üzərindəki hüquqlar tam olaraq istifadəçiyə məxsus olaraq qalır. İstifadəçi bu materialları sistemə daxil etməklə Innova Group Azerbaijan-a yalnız Xidmətin texniki icrasının və funksiyalarının təmin edilməsi üçün zəruri olan həcmdə məhdud emal icazəsi verir.</p>
          <p>4.2. <strong>Modellərin Təkmilləşdirilməsi Funksionallığı (Opt-In):</strong> Yeni yaradılan hesablarda fərdiləşdirilmiş xidmət rejimi və modellərin təkmilləşdirilməsi funksionallığı ilkin olaraq qeyri-aktiv (deaktiv) vəziyyətdə təqdim olunur. İstifadəçi şəxsi profil parametrləri bölməsindən bu funksionallıqları öz açıq iradəsi ilə aktivləşdirmək (opt-in) və ya istədiyi vaxt sərbəst şəkildə deaktiv etmək (opt-out) hüququna malikdir.</p>
          <p>4.3. <strong>Birtərəfli Asılılıq Şərti:</strong> Modellərin təkmilləşdirilməsi funksionallığını aktivləşdirmək üçün fərdiləşdirilmiş xidmət rejimi (yaddaş konteksti) aktiv olmalıdır. İstifadəçi fərdiləşdirilmiş xidmət rejimini deaktiv etdikdə modellərin təkmilləşdirilməsi funksionallığı da sistem tərəfindən avtomatik və dərhal dayandırılır. Bununla yanaşı, istifadəçi fərdiləşdirilmiş xidmət rejimini açıq saxlamaqla yalnız modellərin təkmilləşdirilməsi funksionallığını müstəqil şəkildə deaktiv edə bilər; bu halda yeni sorğuların məzmunu model təkmilləşdirilməsinə cəlb olunmur və yalnız zəruri əməliyyat qeydləri saxlanılır.</p>
          <p>4.4. <strong>Generasiya Edilən Çıxışlar:</strong> Qanunvericiliyin və tərəfdaş provayderlərin icazə verdiyi hüdudlarda istifadəçi öz sorğuları nəticəsində formalaşmış analitik çıxışlardan kommersiya və qeyri-kommersiya məqsədləri üçün sərbəst istifadə edə bilər. Alqoritmik sistemlərin ümumi təbiətinə müvafiq olaraq, oxşar sorğu daxil edən digər şəxslər üçün bənzər nəticələrin hasil edilməsi mümkündür və bu hal çıxışların unikallığına dair iddia irəli sürmək hüququ yaratmır.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 5. Zəmanətlərin İstisnası və Biznes Qərarları</h3>
          <p>5.1. Xidmət və onun bütün funksional imkanları “olduğu kimi” (“as is”) və “mövcud olduğu dərəcədə” (“as available”) prinsipi ilə təqdim edilir.</p>
          <p>5.2. Innova Group Azerbaijan hər hansı kommersiya uğuruna, satış dövriyyəsinin və ya gəlirliliyin artırılmasına, bazar payının qazanılmasına, investisiyaların cəlb edilməsinə və ya Platformanın təqdim etdiyi analitik təkliflərin reallaşmasına dair heç bir birbaşa və ya dolayısı zəmanət vermir. Platformanın məlumatlarına əsaslanaraq həyata keçirilən bütün fəaliyyətin riskləri və iqtisadi nəticələri birbaşa istifadəçinin şəxsi məsuliyyətindədir.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 6. Qadağan Olunmuş İstifadə</h3>
          <p>6.1. Platformadan qanunvericiliyin tələblərini pozan məqsədlər üçün istifadə edilməsi, kibertəhlükəsizlik baryerlərinin aşılmasına yönəlmiş müdaxilələr (o cümlədən prompt injection, model dekompilyasiyası, arxitekturanın tərsinə mühəndisliyi), sistem resurslarının kütləvi sorğularla həddən artıq yüklənməsi və üçüncü tərəflərin qanuni hüquqlarının pozulması qadağandır.</p>
          <p>6.2. İstifadə qaydalarının pozulması faktı aşkar edildikdə, Innova Group Azerbaijan istifadəçinin Platformaya giriş hüququnu xəbərdarlıq etmədən dayandırmaq və ya birdəfəlik ləğv etmək hüququna malikdir.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 7. Zərərlərin Əvəzinin Ödənilməsi (Təqsirə Əsaslanan Məsuliyyət)</h3>
          <p>İstifadəçinin bu Şərtləri qəsdən və ya kobud şəkildə pozması, Platformadan qanunsuz məqsədlər üçün istifadə etməsi və ya sistemə daxil etdiyi materiallarla üçüncü şəxslərin hüquqlarını (o cümlədən əqli mülkiyyət və ya məxfilik hüquqlarını) təqsirli şəkildə pozması nəticəsində Innova Group Azerbaijan-a, onun vəzifəli şəxslərinə və texnoloji tərəfdaşlarına qarşı üçüncü tərəflər tərəfindən irəli sürülmüş əsaslı iddialar üzrə vurulmuş birbaşa zərərin və rəsmi məhkəmə xərclərinin əvəzi qanunvericiliklə müəyyən edilmiş qaydada təqsirkar istifadəçi tərəfindən kompensasiya edilir.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 8. Məsuliyyətin Hədləri və Qanuni İstisnalar</h3>
          <p>8.1. <strong>Dolayı Zərərlər üzrə:</strong> Qanunvericiliyin yol verdiyi hədlərdə Innova Group Azerbaijan Platformadan istifadə və ya ondan istifadənin qeyri-mümkünlüyü, habelə sistem nəticələrinə istinad edilməsi ilə əlaqədar yaranan dolayı zərərlərə, qaçırılmış faydaya, itirilmiş mənfəətə və ya biznesin dayanması nəticəsində yaranan itkilərə görə məsuliyyət daşımır.</p>
          <p>8.2. <strong>Məsuliyyətin Həcmi:</strong> Xidmətin təmənnasız göstərildiyi nəzərə alınaraq, Innova Group Azerbaijan-ın Platforma ilə bağlı yarana biləcək birbaşa məsuliyyəti tətbiq olunan qanunvericiliyin yol verdiyi ağlabatan və minimum hədlə məhdudlaşır; ödənişli xidmətlər təqdim edildiyi halda isə bu məsuliyyət istifadəçinin iddia anından əvvəlki son 12 (on iki) ay ərzində müvafiq xidmət üçün faktiki ödədiyi məbləğdən artıq ola bilməz.</p>
          <p>8.3. <strong>Məhdudlaşdırılması Mümkün Olmayan Hallar:</strong> Bu Şərtlərin heç bir müddəası Innova Group Azerbaijan-ın qəsd və ya kobud ehtiyatsızlığı nəticəsində dəyən zərərə, həyat və sağlamlığa vurulmuş ziyana, habelə Azərbaycan Respublikasının qanunvericiliyi (o cümlədən istehlakçıların hüquqlarının müdafiəsi və mülki hüquq normaları) ilə məhdudlaşdırılması və ya istisna edilməsi qadağan olunan digər məsuliyyət hallarına şamil edilmir və onları aradan qaldırmır.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 9. Xidmətin Fəaliyyəti və Texniki Dəyişikliklər</h3>
          <p>9.1. Platformanın işində texniki profilaktika, qlobal infrastruktur yeniləmələri və ya asılı xarici şəbəkələrin fəaliyyəti ilə əlaqədar fasilələrin və ya gecikmələrin yaranması mümkündür. Innova Group Azerbaijan sistemin tam fasiləsiz işləməsinə dair zəmanət vermir.</p>
          <p>9.2. Innova Group Azerbaijan Platformanın funksional imkanlarını, təqdim olunan modelləri, texniki limitləri və interfeys parametrlərini zərurət olduqda birtərəfli qaydada dəyişdirmək hüququnu saxlayır.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 10. Hesab Təhlükəsizliyi</h3>
          <p>İstifadəçi öz hesabının giriş vasitələrinin və aktiv sessiya açarlarının konfidensiallığını qorumağa görə şəxsən cavabdehdir. Hesaba icazəsiz müdaxilə və ya təhlükəsizlik pozuntusu şübhəsi yarandıqda istifadəçi dərhal Platformanın dəstək xidmətinə məlumat verməlidir.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 11. Şərtlərin Dəyişdirilməsi və Müstəqil Qüvvə</h3>
          <p>11.1. Innova Group Azerbaijan bu Şərtləri zərurət olduqda birtərəfli qaydada yeniləyə bilər. Yenilənmiş Şərtlər Platformada dərc edildiyi andan qüvvəyə minir.</p>
          <p>11.2. Bu Şərtlərin hər hansı müddəasının məhkəmə tərəfindən etibarsız və ya icraedilməz hesab edilməsi digər bəndlərin hüquqi qüvvəsinə təsir göstərmir.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 12. Mübahisələrin Həlli və Tətbiq Olunan Hüquq</h3>
          <p>12.1. Bu Şərtlər Azərbaycan Respublikasının maddi və prosessual qanunvericiliyinə uyğun olaraq tənzimlənir və şərh edilir.</p>
          <p>12.2. Tərəflər arasında yaranan bütün fikir ayrılıqları qarşılıqlı danışıqlar yolu ilə həll edilir. Razılıq əldə edilmədikdə, mübahisələr Azərbaycan Respublikasının müvafiq yurisdiksiyaya malik səlahiyyətli məhkəmələri tərəfindən araşdırılır.</p>
        </div>
      `,
    },
    privacy: {
      title: "Məxfilik Siyasəti",
      subtitle: "Fərdi və konfidensial məlumatların toplanması, emalı, saxlanması və mühafizəsi qaydaları",
      html: `
        <table class="legal-table">
          <thead>
            <tr>
              <th>Sənəd Göstəriciləri</th>
              <th>Təfsilat</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Son yenilənmə tarixi</strong></td>
              <td>3 oktyabr 2026</td>
            </tr>
            <tr>
              <td><strong>Qüvvəyə minmə tarixi</strong></td>
              <td>3 oktyabr 2026</td>
            </tr>
            <tr>
              <td><strong>Xidmət operatoru</strong></td>
              <td>Innova Group Azerbaijan</td>
            </tr>
            <tr>
              <td><strong>Rəsmi internet informasiya ehtiyatı</strong></td>
              <td><a href="https://helmeros.com">helmeros.com</a></td>
            </tr>
            <tr>
              <td><strong>Məxfilik məsələləri üzrə əlaqə</strong></td>
              <td><a href="mailto:support@helmeros.com">support@helmeros.com</a></td>
            </tr>
            <tr>
              <td><strong>Hüquqi status</strong></td>
              <td>Təmənnasız, qeyri-kommersiya əsaslı rəqəmsal xidmət</td>
            </tr>
          </tbody>
        </table>

        <div class="legal-highlight-box">
          <strong>✦ Google API İstifadəçi Məlumatları Siyasətinə Uyğunluq (Limited Use Tələbi)</strong>
          <p>Helmer Strategy OS platformasının Google API-lərindən əldə edilmiş məlumatlardan istifadəsi və onları hər hansı digər tətbiqə ötürməsi, Məhdud İstifadə (Limited Use) tələbləri də daxil olmaqla, <a href="https://developers.google.com/terms/api-services-user-data-policy#limited-use" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a> şərtlərinə tam şəkildə uyğundur.</p>
        </div>

        <div class="legal-doc-section">
          <p><strong>Preambula</strong></p>
          <p>Bu Məxfilik Siyasəti (“Siyasət”) Innova Group Azerbaijan tərəfindən idarə olunan Helmer Strategy OS platformasında (“Helmer Strategy OS”, “Platforma”, “Xidmət”, “Məlumat Sahibi / İdarəçi”) istifadəçilərə aid fərdi və konfidensial məlumatların toplanması, emalı, saxlanması, mühafizəsi və ötürülməsi qaydalarını müəyyən edir.</p>
          <p>Platformadan istifadə edilməsi ilə istifadəçi Azərbaycan Respublikasının “Fərdi məlumatlar haqqında” Qanununa və tətbiq olunan digər qanunvericilik aktlarına uyğun olaraq, öz fərdi məlumatlarının bu Siyasətdə təsbit edilmiş şərtlər və hədlər çərçivəsində toplanmasına və emal edilməsinə razılığını ifadə etmiş olur.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 1. Əsas Prinsiplər və Qeyri-Kommersiya Xarakteri</h3>
          <p>1.1. Platforma qeyri-kommersiya tədqiqat və strateji idarəetmə təşəbbüsü kimi fəaliyyət göstərir və təmənnasız təqdim edilir.</p>
          <p>1.2. İstifadəçilərin fərdi məlumatları birbaşa və ya dolayısı ilə kommersiya gəliri əldə etmək məqsədilə üçüncü şəxslərə satılmır, reklam şəbəkələrinə və ya məlumat brokerlərinə ötürülmür.</p>
          <p>1.3. Məlumatların emalı qanunilik, konfidensiallıq, məqsədəuyğunluq və məlumatların minimallaşdırılması prinsiplərinə əsaslanır; yalnız Xidmətin texniki və funksional fəaliyyəti üçün zəruri olan minimum məlumat həcmi emala cəlb olunur.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 2. Emal Edilən Məlumat Kateqoriyaları</h3>
          <p>Platforma xidmətlərin göstərilməsi və sistem təhlükəsizliyinin təmin olunması məqsədilə aşağıdakı kateqoriyalar üzrə məlumatları emal edir:</p>
          <p><strong>2.1. İdentifikasiya və Giriş Göstəriciləri:</strong> İstifadəçinin adı, soyadı, istifadəçi adı, elektron poçt ünvanı və təhlükəsiz şəkildə kriptoqrafik heşlənmiş daxili identifikasiya parametrləri (User ID).</p>
          <p><strong>2.2. Google Giriş Göstəriciləri (Google OAuth 2.0):</strong> İstifadəçi Platformaya vahid giriş texnologiyası vasitəsilə daxil olduqda, autentifikasiya təminatçısı tərəfindən yalnız icazə verilmiş baza profil məlumatları (istifadəçinin adı, soyadı, e-poçt ünvanı, profil təsvirinin internet ünvanı və sistem təhlükəsizlik tokeni) qəbul edilir. İstifadəçinin xarici platforma şifrələrinə, kontaktlar siyahısına, bulud saxlancına və ya digər fərdi sənədlərinə heç bir halda çıxış əldə olunmur və saxlanılmır.</p>
          <p><strong>2.3. Biznes və Məzmun Konteksti:</strong> İstifadəçi tərəfindən sistemə daxil edilən strateji briflər, bazar təhlili parametrləri, suallar (Giriş Məlumatları), sistem tərəfindən hasil edilən analitik planlar, generasiya olunmuş hesabatlar (Çıxış Məlumatları), qarşılıqlı əlaqə tarixçəsi və layihə qeydləri.</p>
          <p><strong>2.4. Texniki və Şəbəkə Təhlükəsizliyi Göstəriciləri:</strong> Şəbəkə təhlükəsizliyinin auditi və texniki nasazlıqların aradan qaldırılması üçün sessiya açarları, IP ünvanları, əməliyyat sistemi göstəriciləri, brauzer növü və sistem hadisələrinin qeydiyyat jurnalları (server logları).</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 3. Fərdiləşdirilmiş Rejim, Modellərin Təkmilləşdirilməsi və Birtərəfli Asılılıq Mexanizmi</h3>
          <p>Platformada məlumatların istifadə tərzinə nəzarət edən aşağıdakı mexanizmlər tətbiq olunur:</p>
          <p><strong>3.1. Fərdiləşdirilmiş Təcrübə Rejimi:</strong> Platforma cavabların istifadəçinin fərdi biznes strukturuna, üslubuna və layihə kontekstinə uyğunlaşdırılması məqsədilə konfiqurasiya edilə bilən fərdiləşdirilmiş yaddaş rejimini təqdim edir.</p>
          <p><strong>3.2. Modellərin Təkmilləşdirilməsi Funksionallığı (Opt-In):</strong> Yeni yaradılan istifadəçi hesablarında həm fərdiləşdirilmiş təcrübə rejimi, həm də modellərin təkmilləşdirilməsi funksionallığı ilkin olaraq qeyri-aktiv (deaktiv) vəziyyətdə təqdim olunur. İstifadəçi şəxsi profil parametrləri bölməsindən bu funksionallıqları açıq razılıqla aktivləşdirmək (opt-in) və ya istədiyi vaxt sərbəst şəkildə deaktiv etmək (opt-out) hüququna malikdir.</p>
          <p><strong>3.3. Birtərəfli Asılılıq və Avtomatik Deaktivasiya Qaydası:</strong> Modellərin təkmilləşdirilməsi funksionallığını aktivləşdirmək üçün fərdiləşdirilmiş təcrübə rejimi açıq olmalıdır. İstifadəçi fərdiləşdirilmiş təcrübə rejimini deaktiv etdikdə modellərin təkmilləşdirilməsi funksionallığı da sistem tərəfindən dərhal və avtomatik qaydada dayandırılır. Bununla yanaşı, istifadəçi fərdiləşdirilmiş təcrübə rejimini aktiv saxlayaraq yalnız modellərin təkmilləşdirilməsi funksionallığını müstəqil şəkildə söndürə bilər; bu halda yeni sorğuların və cavabların məzmunu model təkmilləşdirilməsinə daxil edilmir, mövcud təlim namizədləri silinir və yalnız zəruri əməliyyat məlumatları saxlanılır.</p>
          <p><strong>3.4. Anonimləşdirmə Tədbirləri:</strong> Modellərin təkmilləşdirilməsi prosesinə yönləndirilən məlumatların şəxsi göstəricilərdən təmizlənməsi (sanitization / de-identification) məqsədilə avtomatlaşdırılmış süzgəclər tətbiq olunur; birbaşa identifikasiya detalları kənarlaşdırılır və məlumatlar istifadəçi profilindən ayrılmış şəkildə emal edilir. Bununla belə, sərbəst daxil edilən mətnlərin daxili xüsusiyyətlərinə görə bütün fərdi detalların kənarlaşdırılmasına mütləq zəmanət verilə bilməz və istifadəçilərə sistemə həssas məlumatları daxil etməmək tövsiyə olunur.</p>
          <p><strong>3.5. İmtinanın Texniki Sərhədi:</strong> Funksionallıq deaktiv edildikdən sonra yeni daxil edilən sorğuların modellərin təkmilləşdirilməsi məqsədilə toplanması dərhal dayandırılır, davam edən icralar dayandırılır və mövcud təlim namizədləri eksport siyahısından çıxarılır.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 4. Həssas Məlumatlar və İstifadəçinin Fərdi Məsuliyyəti</h3>
          <p>4.1. Helmer Strategy OS biznes və strateji təhlil platformasıdır; sistemin funksional fəaliyyəti üçün xüsusi kateqoriyalı və ya yüksək həssaslıqlı fərdi məlumatların toplanmasına zərurət yoxdur.</p>
          <p>4.2. Aşağıdakı məlumatların Platformaya daxil edilməməsi qətiyyətlə tələb olunur:</p>
          <ul>
            <li>Bank kartı rekvizitləri, CVV/CVC kodları və maliyyə hesabı sirləri;</li>
            <li>Şəxsiyyəti təsdiq edən sənədlərin seriya, nömrə və fərdi identifikasiya nömrələri (FİN);</li>
            <li>Biometrik, genetik və ya sağlamlıq göstəriciləri;</li>
            <li>Konfidensial giriş açarları və sistem şifrələri.</li>
          </ul>
          <p>4.3. İstifadəçi bu tələbə zidd olaraq öz təşəbbüsü ilə qeyd olunan məlumatları sistemə daxil etdiyi təqdirdə, onların avtomatlaşdırılmış emala məruz qalması riskini və bundan doğan bütün məsuliyyəti şəxsən daşıyır.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 5. Süni İntellekt İnfrastrukturu və Transsərhəd Ötürülmə</h3>
          <p>5.1. Platforma analitik təhlil, canlı veb axtarış (Grounding) və strukturlaşdırılmış mətn generasiyası funksiyalarını icra etmək üçün rəsmi korporativ API şəbəkələrindən və sub-prosessorlardan — o cümlədən <strong>Google Cloud (Vertex AI / Gemini API, Google Search Grounding)</strong> və <strong>OpenAI</strong> infrastrukturundan — istifadə edir.</p>
          <p>5.2. Məlumat axını təhlükəsiz TLS/HTTPS şifrələmə standartları vasitəsilə həyata keçirilir və sorğular cari generasiya sessiyasının texniki icrası üçün zəruri olan həcmdə emal edilir.</p>
          <p>5.3. İstifadəçilərin biznes sorğuları və fərdi göstəriciləri üçüncü tərəflərin ümumi kütləvi modellərinin açıq təlimi (public training) üçün istifadə edilmir.</p>
          <p>5.4. Xidmətin hesablama qovşaqları Azərbaycan Respublikasının hüdudlarından kənarda yerləşə bilər. İstifadəçi Platformadan istifadə etməklə Xidmətin icrası üçün zəruri olan texniki məlumatların Azərbaycan Respublikasının “Fərdi məlumatlar haqqında” Qanununun tələblərinə və beynəlxalq şifrələmə protokollarına müvafiq olaraq xaricdə yerləşən serverlərdə tranzit emalına razılıq verir.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 6. Google API və Google Search Grounding Məlumatları Siyasətinə Uyğunluq</h3>
          <p>6.1. <strong>Məhdud İstifadə Bəyannaməsi:</strong> Platformanın Google API-ləri vasitəsilə əldə edilmiş məlumatlardan istifadəsi və onları hər hansı digər tətbiqə ötürməsi, Məhdud İstifadə (Limited Use) tələbləri də daxil olmaqla, <a href="https://developers.google.com/terms/api-services-user-data-policy#limited-use" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a> və <a href="https://cloud.google.com/terms/service-terms" target="_blank" rel="noopener noreferrer">Google Cloud Service Specific Terms</a> şərtlərinə tam şəkildə uyğundur.</p>
          <p>6.2. <strong>Modellərin Təlimində və Üçüncü Tərəf Ötürülməsində İstifadə Qadağası:</strong> Google API-ləri vasitəsilə əldə edilən istifadəçi məlumatları (o cümlədən ad, e-poçt ünvanı və profil göstəriciləri), eləcə də Google Search Grounding vasitəsilə əldə edilən axtarış nəticələri (Grounded Results) və axtarış təklifləri (Search Suggestions) heç bir halda süni intellekt və maşın öyrənməsi modellərinin təlimi (training, fine-tuning), təlim datasetlərinin eksportu və ya qeyri-Google üçüncü tərəf modellərinə ötürülməsi üçün istifadə edilmir.</p>
          <p>6.3. <strong>Satış və Reklam Qadağası:</strong> Google istifadəçi məlumatları heç bir halda reklam şəbəkələrinə, məlumat alverçilərinə satılmır, icarəyə verilmir və hədəfli reklam nümayişi məqsədilə emal olunmur.</p>
          <p>6.4. <strong>İcazələrin Ləğvi:</strong> İstifadəçilər Platformaya verilmiş Google icazələrini istənilən vaxt birbaşa öz <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google Hesabının təhlükəsizlik parametrləri</a> bölməsindən ləğv edə bilərlər.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 7. Məlumatların Saxlanması, İnfrastruktur və İnformasiya Təhlükəsizliyi</h3>
          <p>7.1. Məlumatların bütövlüyü və konfidensiallığı müasir bulud saxlanc infrastrukturları (Cloudflare R2), operativ keşləmə qovşaqları (Redis) və beynəlxalq sertifikatlaşdırılmış server mühiti vasitəsilə təmin olunur.</p>
          <p>7.2. Məlumat bazalarına icazəsiz girişin, məlumat sızmasının və ya təhrif olunmasının qarşısını almaq üçün Azərbaycan Respublikasının “İnformasiya, informasiyalaşdırma və informasiyanın mühafizəsi haqqında” Qanununun tələblərinə uyğun təşkilati və proqram-texniki mühafizə tədbirləri tətbiq edilir.</p>
          <p>7.3. Fərdi məlumatlar istifadəçinin aktiv hesabı mövcud olduğu müddətdə saxlanılır. Hesab ləğv edildikdə fərdi məlumatlar aktiv sistemlərdən kənarlaşdırılır. Texniki loglar şəbəkə təhlükəsizliyi məqsədilə rotasiya qaydalarına uyğun olaraq müəyyən müddətdən sonra avtomatik silinir.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 8. Yetkinlik Yaşına Çatmayan Şəxslərin Məlumatlarının Qorunması</h3>
          <p>8.1. Azərbaycan Respublikasının Mülki Məcəlləsinin fəaliyyət qabiliyyətinə dair müddəalarına uyğun olaraq, Helmer Strategy OS yalnız 18 yaşına çatmış şəxslərin istifadəsi üçün nəzərdə tutulur və 18 yaşından aşağı şəxslərdən bilərəkdən fərdi məlumat toplamır.</p>
          <p>8.2. 18 yaşına çatmamış şəxsə aid fərdi məlumatların Platformaya daxil edildiyi aşkar edildikdə və ya bu barədə müraciət daxil olduqda, həmin məlumatlar və əlaqəli profil aktiv sistemlərdən kənarlaşdırılır.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 9. İstifadəçinin Qanuni Hüquqları və Hesabın Silinməsi Qaydası</h3>
          <p>Azərbaycan Respublikasının “Fərdi məlumatlar haqqında” Qanununa əsasən, istifadəçi aşağıdakı hüquqlara malikdir:</p>
          <ul>
            <li>Öz fərdi məlumatlarının emal edilib-edilməməsi barədə məlumat almaq və onların tərkibi ilə tanış olmaq;</li>
            <li>Saxlanılan biznes təhlillərini, qarşılıqlı əlaqə tarixçəsini və fərdiləşdirmə yaddaşını Platformanın interfeysi vasitəsilə istənilən vaxt silmək;</li>
            <li>Şəxsi parametrlər vasitəsilə fərdiləşdirilmiş rejim və modellərin təkmilləşdirilməsi seçimlərini idarə etmək və ya söndürmək;</li>
            <li>Profilinin və fərdi məlumatlarının aktiv sistemlərdən tam silinməsini tələb etmək.</li>
          </ul>
          <p>Hesabın silinməsi və hüquqların həyata keçirilməsi üzrə rəsmi müraciətlər <a href="mailto:support@helmeros.com">support@helmeros.com</a> elektron poçt ünvanına göndərilir. Qanunvericiliklə nəzərdə tutulmuş digər saxlama tələbi olmadığı təqdirdə, sorğu 30 təqvim günü ərzində icra edilir.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Maddə 10. Siyasətin Dəyişdirilməsi və Əlaqə Rekvizitləri</h3>
          <p>10.1. Innova Group Azerbaijan qanunvericilikdəki dəyişikliklər və ya Platformanın texniki arxitekturasındakı yeniliklərlə əlaqədar bu Siyasətə birtərəfli qaydada dəyişikliklər etmək hüququnu özündə saxlayır. Yenilənmiş Siyasət Platformada dərc edildiyi andan qüvvəyə minir.</p>
          <p>10.2. Hüquqi və Texniki Əlaqə:</p>
          <ul>
            <li><strong>Xidmət operatoru:</strong> Innova Group Azerbaijan, Bakı, Azərbaycan</li>
            <li><strong>Platforma:</strong> Helmer Strategy OS</li>
            <li><strong>Rəsmi internet informasiya ehtiyatı:</strong> <a href="https://helmeros.com">helmeros.com</a></li>
            <li><strong>Məxfilik və hüquqi məsələlər üzrə əlaqə:</strong> <a href="mailto:support@helmeros.com">support@helmeros.com</a></li>
          </ul>
          <p>© 2026 Innova Group Azerbaijan / Helmer Strategy OS. Bütün hüquqlar qorunur.</p>
        </div>
      `,
    },
  },
  en: {
    terms: {
      title: "Terms of Service",
      subtitle: "Terms and conditions governing access to and use of Helmer Strategy OS",
      html: `
        <table class="legal-table">
          <thead>
            <tr>
              <th>Document Details</th>
              <th>Specifics</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Effective Date</strong></td>
              <td>October 3, 2026</td>
            </tr>
            <tr>
              <td><strong>Service Operator</strong></td>
              <td>Innova Group Azerbaijan</td>
            </tr>
            <tr>
              <td><strong>Official Internet Information Resource</strong></td>
              <td><a href="https://helmeros.com">helmeros.com</a></td>
            </tr>
            <tr>
              <td><strong>Legal & Technical Contact Address</strong></td>
              <td><a href="mailto:support@helmeros.com">support@helmeros.com</a></td>
            </tr>
          </tbody>
        </table>

        <div class="legal-highlight-box">
          <strong>✦ Preamble and Artificial Intelligence Infrastructure</strong>
          <p>Helmer Strategy OS platform utilizes artificial intelligence algorithms, large language models (LLMs), application programming interfaces (APIs), and third-party computing technologies for conducting analytical research, business strategy modeling, market research, and producing structured analytical intelligence. The system models, technical providers, and architectural solutions utilized may be unilaterally modified or updated by Innova Group Azerbaijan in accordance with the operational necessities of the platform.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 1. General Provisions and Parties' Consent</h3>
          <p>1.1. These Terms of Service (“Terms”) govern the access to and use of the Helmer Strategy OS platform (“Helmer Strategy OS”, “Helmer”, “Platform”, “Service”) operated by Innova Group Azerbaijan, as well as the rights and obligations of the parties.</p>
          <p>1.2. Any form of use of the Platform, including account registration or submitting queries to the system, confirms that the user has fully reviewed these Terms, understands their legal binding force, and gives unconditional consent to their performance. Persons who do not agree with these Terms have no right to use the Platform.</p>
          <p>1.3. Helmer Strategy OS is a digital software environment of an auxiliary nature designed for strategic and business analyses.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 2. Age Limit and Legal Capacity</h3>
          <p>2.1. In accordance with the relevant requirements of the Civil Code of the Republic of Azerbaijan, the Platform is intended for use solely by fully capable individuals who have reached 18 years of age.</p>
          <p>2.2. Each individual using the Platform officially declares and confirms that they are at least 18 years of age and possess the necessary legal capacity and authority to enter into contracts and undertake obligations.</p>
          <p>2.3. If it is determined that the Platform is being used by individuals under 18 years of age, Innova Group Azerbaijan reserves the right to immediately and unilaterally suspend or terminate service to the respective account without prior notice.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 3. Non-Reliance and Exclusion of Professional Advice</h3>
          <p>3.1. All analytical structures, business models, market analyses, budget allocations, and action plans provided through the Platform are purely auxiliary, conceptual, and informational in nature.</p>
          <p>3.2. The Platform’s operations and provided outputs do not substitute for expert opinions in professional legal, financial, investment, tax, or other licensed domains. No fiduciary, consulting, or other professional agency relationship is established between the user and Innova Group Azerbaijan.</p>
          <p>3.3. By the nature of artificial intelligence technologies, outputs generated by the system may contain inaccurate, incomplete, outdated, or distorted facts (algorithmic hallucination risk). The user personally bears the responsibility to independently verify the accuracy of such information through specialized professionals before making any commercial, operational, financial, or legal decisions based on the Platform’s data.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 4. Intellectual Property, Content, and Personalization / Model Improvement Dependency</h3>
          <p>4.1. <strong>User Content:</strong> Rights to individual business descriptions, briefs, analysis documents, and other materials submitted by the user to the system (“User Content”) remain fully owned by the user. By submitting these materials to the system, the user grants Innova Group Azerbaijan a limited processing license solely to the extent necessary to ensure the technical execution and functions of the Service.</p>
          <p>4.2. <strong>Model Improvement Functionality (Opt-In):</strong> For newly created accounts, both the personalized service mode and the model improvement functionality are disabled (inactive) by default. The user has the right to explicitly enable (opt in) or freely deactivate (opt out) these functionalities at any time from their personal profile settings.</p>
          <p>4.3. <strong>One-Way Dependency Condition:</strong> Personalized service mode (memory context) must be active in order to enable the model improvement functionality. When the personalized service mode is deactivated by the user, the model improvement functionality is also automatically and immediately discontinued by the system. Conversely, the user may independently deactivate the model improvement functionality while keeping personalized service mode active; in that case, new interaction content is excluded from model improvement and only necessary operational records are retained.</p>
          <p>4.4. <strong>Generated Outputs:</strong> Within the limits permitted by applicable law and partner providers, the user may freely use analytical outputs generated as a result of their queries for commercial and non-commercial purposes. In accordance with the general nature of algorithmic systems, similar results may be generated for other individuals submitting similar queries, and this circumstance does not grant the right to assert claims regarding the uniqueness of the outputs.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 5. Disclaimer of Warranties and Business Decisions</h3>
          <p>5.1. The Service and all its functional capabilities are provided on an “as is” and “as available” basis.</p>
          <p>5.2. Innova Group Azerbaijan provides no direct or implied warranty regarding any commercial success, increase in sales turnover or profitability, acquisition of market share, attracting investments, or the implementation of analytical proposals presented by the Platform. All risks and economic outcomes of activities conducted on the basis of the Platform’s data are the direct personal responsibility of the user.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 6. Prohibited Use</h3>
          <p>6.1. Using the Platform for purposes that violate statutory requirements, interventions aimed at bypassing cybersecurity barriers (including prompt injection, model decompilation, reverse engineering of architecture), overloading system resources with mass queries, and infringing upon the lawful rights of third parties are strictly prohibited.</p>
          <p>6.2. When a violation of usage rules is detected, Innova Group Azerbaijan has the right to suspend or permanently terminate the user’s access to the Platform without prior notice.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 7. Indemnification of Damages (Fault-Based Liability)</h3>
          <p>In the event that the user intentionally or grossly violates these Terms, uses the Platform for unlawful purposes, or culpably infringes third-party rights (including intellectual property or privacy rights) with materials submitted to the system, the direct damages and official court expenses incurred by Innova Group Azerbaijan, its officers, and technology partners as a result of substantiated claims brought by third parties shall be compensated by the culpable user in accordance with applicable legislation.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 8. Limitations of Liability and Statutory Exceptions</h3>
          <p>8.1. <strong>Indirect Damages:</strong> To the extent permitted by law, Innova Group Azerbaijan bears no liability for indirect damages, lost profits, loss of anticipated revenue, loss of earnings, or losses resulting from business interruption arising out of the use or inability to use the Platform, or reliance upon system results.</p>
          <p>8.2. <strong>Scope of Liability:</strong> Considering that the Service is provided free of charge, Innova Group Azerbaijan’s direct liability arising in connection with the Platform is limited to the reasonable and minimum threshold permitted by applicable law; in cases where paid services are provided, such liability shall not exceed the actual amount paid by the user for the respective service during the preceding 12 (twelve) months prior to the claim.</p>
          <p>8.3. <strong>Non-Excludable Statutory Liabilities:</strong> No provision of these Terms shall apply to or eliminate liability for damages caused by the intent or gross negligence of Innova Group Azerbaijan, harm to life and health, or other liability cases whose limitation or exclusion is prohibited by the legislation of the Republic of Azerbaijan (including consumer protection and civil law norms).</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 9. Service Operations and Technical Modifications</h3>
          <p>9.1. Interruptions or delays may occur in the operation of the Platform due to technical maintenance, global infrastructure updates, or the operation of dependent external networks. Innova Group Azerbaijan does not guarantee uninterrupted operation of the system.</p>
          <p>9.2. Innova Group Azerbaijan reserves the right to unilaterally modify the Platform’s functional capabilities, provided models, technical limits, and interface parameters whenever necessary.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 10. Account Security</h3>
          <p>The user is personally responsible for maintaining the confidentiality of their account credentials and active session keys. The user must immediately notify the Platform’s support service upon suspecting unauthorized access to the account or a security breach.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 11. Amendments to Terms and Severability</h3>
          <p>11.1. Innova Group Azerbaijan may unilaterally update these Terms when necessary. Updated Terms take effect from the moment of their publication on the Platform.</p>
          <p>11.2. If any provision of these Terms is deemed invalid or unenforceable by a court, this shall not affect the legal validity of the remaining provisions.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 12. Dispute Resolution and Applicable Law</h3>
          <p>12.1. These Terms are governed by and construed in accordance with the substantive and procedural laws of the Republic of Azerbaijan.</p>
          <p>12.2. All disagreements arising between the parties shall be resolved through mutual negotiations. If an agreement cannot be reached, disputes shall be adjudicated by the competent courts possessing jurisdiction in the Republic of Azerbaijan.</p>
        </div>

        <div class="legal-doc-precedence">
          <p><strong>Governing Language Precedence:</strong> This document is translated from the original Azerbaijani version for convenience. In the event of any conflict, discrepancy, ambiguity, or dispute between this English translation and the original Azerbaijani text, the original Azerbaijani version shall govern and prevail.</p>
        </div>
      `,
    },
    privacy: {
      title: "Privacy Policy",
      subtitle: "Rules and standards for the collection, processing, retention, and protection of personal data",
      html: `
        <table class="legal-table">
          <thead>
            <tr>
              <th>Document Metrics</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Last Updated Date</strong></td>
              <td>October 3, 2026</td>
            </tr>
            <tr>
              <td><strong>Effective Date</strong></td>
              <td>October 3, 2026</td>
            </tr>
            <tr>
              <td><strong>Service Operator</strong></td>
              <td>Innova Group Azerbaijan</td>
            </tr>
            <tr>
              <td><strong>Official Internet Information Resource</strong></td>
              <td><a href="https://helmeros.com">helmeros.com</a></td>
            </tr>
            <tr>
              <td><strong>Privacy Matters Contact</strong></td>
              <td><a href="mailto:support@helmeros.com">support@helmeros.com</a></td>
            </tr>
            <tr>
              <td><strong>Legal Status</strong></td>
              <td>Gratuitous, non-commercial digital service</td>
            </tr>
          </tbody>
        </table>

        <div class="legal-highlight-box">
          <strong>✦ Google API User Data Policy Compliance (Limited Use Requirement)</strong>
          <p>Helmer Strategy OS platform's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy#limited-use" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
        </div>

        <div class="legal-doc-section">
          <p><strong>Preamble</strong></p>
          <p>This Privacy Policy (“Policy”) governs the rules for the collection, processing, storage, protection, and cross-border transfer of personal and confidential data belonging to users within the Helmer Strategy OS platform (“Helmer Strategy OS”, “Platform”, “Service”, “Data Controller / Administrator”) operated by Innova Group Azerbaijan.</p>
          <p>By using the Platform, the user expresses their consent to the collection and processing of their personal data within the conditions and limits established in this Policy, in accordance with the Law of the Republic of Azerbaijan “On Personal Data” and other applicable legislative acts.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 1. Core Principles and Non-Commercial Character</h3>
          <p>1.1. The Platform operates as a non-commercial research and strategic governance initiative and is provided free of charge.</p>
          <p>1.2. Users' personal data is not sold to third parties, advertising networks, or data brokers for the purpose of obtaining direct or indirect commercial profit.</p>
          <p>1.3. Data processing is based on the principles of legality, confidentiality, purposefulness, and data minimization; only the minimum volume of data necessary for the technical and functional operation of the Service is involved in processing.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 2. Categories of Processed Data</h3>
          <p>The Platform processes data under the following categories for the purpose of providing services and ensuring system security:</p>
          <p><strong>2.1. Identification and Access Metrics:</strong> User's first name, last name, username, email address, and internal identification parameters securely hashed via cryptography (User ID).</p>
          <p><strong>2.2. Google Sign-In Metrics (Google OAuth 2.0):</strong> When a user accesses the Platform via single sign-on technology, only permitted base profile data (user's first name, last name, email address, profile photo URL, and system security token) provided by the authentication provider is accepted. Under no circumstances are the user's external platform passwords, contacts list, cloud storage, or other personal documents accessed or stored.</p>
          <p><strong>2.3. Business and Content Context:</strong> Strategic briefs, market analysis parameters, queries (Input Data) submitted to the system by the user, and analytical plans, generated reports (Output Data), interaction history, and project notes produced by the system.</p>
          <p><strong>2.4. Technical and Network Security Metrics:</strong> Session keys, IP addresses, operating system metrics, browser type, and system event logs (server logs) for cybersecurity auditing and troubleshooting.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 3. Personalized Mode, Model Improvement, and One-Way Dependency Mechanism</h3>
          <p>The following mechanisms governing how data is used are implemented on the Platform:</p>
          <p><strong>3.1. Personalized Experience Mode:</strong> The Platform offers a configurable personalized memory mode to adapt responses to the user's individual business structure, style, and project context.</p>
          <p><strong>3.2. Model Improvement Functionality (Opt-In):</strong> For newly created user accounts, both the personalized experience mode and the model improvement functionality are disabled (inactive) by default. The user has the right to explicitly enable (opt in) or freely deactivate (opt out) these functionalities at any time via personal profile settings.</p>
          <p><strong>3.3. One-Way Dependency and Automatic Deactivation Rule:</strong> The personalized experience mode must be active in order to enable the model improvement functionality. When the user deactivates the personalized experience mode from profile settings, the model improvement functionality is also immediately and automatically stopped by the system. Conversely, the user may independently deactivate the model improvement functionality while keeping the personalized experience mode active; in that case, newly submitted queries and outputs are excluded from model improvement, existing training candidates are purged, and only necessary operational records are retained.</p>
          <p><strong>3.4. Anonymization Measures:</strong> Automated filters are applied for sanitizing/de-identifying data transmitted to the model improvement process; direct identification details are removed and data is processed detached from the user profile. Nonetheless, due to the inherent nuances of free-form text input, absolute removal of all personal details cannot be unconditionally guaranteed, and users are strongly advised not to enter sensitive data into the system.</p>
          <p><strong>3.5. Technical Boundary of Opt-Out:</strong> Upon deactivating the functionality, collection of newly submitted queries for model improvement purposes ceases immediately, in-flight executions are halted, and existing training candidates are removed from export eligibility.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 4. Sensitive Data and User's Personal Responsibility</h3>
          <p>4.1. Helmer Strategy OS is a business and strategic analysis platform; there is no necessity for collecting special categories of or highly sensitive personal data for the system's operations.</p>
          <p>4.2. It is strictly requested not to input the following data into the Platform:</p>
          <ul>
            <li>Bank card credentials, CVV/CVC codes, and financial account secrets;</li>
            <li>Identity document series, numbers, and personal identification numbers (FIN);</li>
            <li>Biometric, genetic, or health data;</li>
            <li>Confidential access keys and system passwords.</li>
          </ul>
          <p>4.3. If the user, contrary to this recommendation, inputs such information into the system on their own initiative, they personally bear the risk of its exposure to automated processing and all liability arising therefrom.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 5. Artificial Intelligence Infrastructure and Cross-Border Transfer</h3>
          <p>5.1. The Platform utilizes official enterprise API networks and AI subprocessors — including <strong>Google Cloud (Vertex AI / Gemini API, Google Search Grounding)</strong> and <strong>OpenAI</strong> — to execute analytical research, live web grounding, and structured text generation functions.</p>
          <p>5.2. Data transfer is conducted via secure TLS/HTTPS encryption standards, and queries are processed solely to the extent necessary for the technical execution of the active generation session.</p>
          <p>5.3. Users' business queries and personal metrics are not used for public training of third parties' general public foundation models.</p>
          <p>5.4. The Service's computing nodes may be located outside the borders of the Republic of Azerbaijan. By using the Platform, the user consents to the transit processing on servers located abroad of technical data necessary for executing the Service, in accordance with the requirements of the Law of the Republic of Azerbaijan “On Personal Data” and international encryption protocols.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 6. Google API and Google Search Grounding Data Policy Compliance</h3>
          <p>6.1. <strong>Limited Use Disclosure:</strong> The Platform's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy#limited-use" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a> and the <a href="https://cloud.google.com/terms/service-terms" target="_blank" rel="noopener noreferrer">Google Cloud Service Specific Terms</a>, including the Limited Use requirements.</p>
          <p>6.2. <strong>Prohibition on Model Training and Third-Party Transfer:</strong> User data received via Google APIs (including name, email address, and profile metrics), as well as search results (Grounded Results) and search queries/suggestions (Search Suggestions) obtained via Google Search Grounding, are strictly never used to train (training, fine-tuning) artificial intelligence or machine learning models, never exported in training datasets, and never transferred to non-Google third-party models.</p>
          <p>6.3. <strong>Prohibition on Sale and Advertising:</strong> Google user data is under no circumstances sold or leased to advertising networks or data brokers, nor processed for serving targeted advertisements.</p>
          <p>6.4. <strong>Revocation of Permissions:</strong> Users may revoke Google permissions granted to the Platform at any time directly from the security settings section of their <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google Account</a>.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 7. Data Storage, Infrastructure, and Information Security</h3>
          <p>7.1. Data integrity and confidentiality are ensured through modern cloud storage infrastructures (Cloudflare R2), high-performance caching nodes (Redis), and an internationally certified server environment.</p>
          <p>7.2. Organizational and software-technical protection measures are implemented in compliance with the Law of the Republic of Azerbaijan “On Information, Informatization, and Protection of Information” to prevent unauthorized access to databases, data leaks, or tampering.</p>
          <p>7.3. Personal data is retained while the user's active account exists. Upon account termination, personal data is removed from active systems. Technical logs are automatically renewed or cleared after a specified period in accordance with cybersecurity rotation rules.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 8. Protection of Minors' Data</h3>
          <p>8.1. In accordance with the provisions on legal capacity under the Civil Code of the Republic of Azerbaijan, Helmer Strategy OS is intended for use solely by individuals who have reached 18 years of age and does not knowingly collect personal data from individuals under 18 years of age.</p>
          <p>8.2. If personal data belonging to an individual under 18 years of age is detected to have been entered into the Platform or upon receipt of an inquiry regarding this, such data and the associated profile are removed from active systems.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 9. Statutory Rights of the User and Account Deletion Procedure</h3>
          <p>Under the Law of the Republic of Azerbaijan “On Personal Data”, the user has the following rights:</p>
          <ul>
            <li>To receive information regarding whether their personal data is being processed and to inspect its composition;</li>
            <li>To delete stored business analyses, interaction history, and personalization memory through the Platform’s interface at any time;</li>
            <li>To manage or disable personalized mode and model improvement preferences via personal settings;</li>
            <li>To request complete deletion of their profile and personal data from active systems.</li>
          </ul>
          <p>Official requests regarding account deletion and exercising statutory rights are sent to the email address <a href="mailto:support@helmeros.com">support@helmeros.com</a>. Unless there is another retention requirement provided by law, the request is executed within 30 calendar days.</p>
        </div>

        <div class="legal-doc-section">
          <h3>Article 10. Amendments to Policy and Contact Details</h3>
          <p>10.1. Innova Group Azerbaijan reserves the right to make unilateral changes to this Policy in connection with legislative changes or technical architecture updates of the Platform. The updated Policy enters into force from the moment it is published on the Platform.</p>
          <p>10.2. Legal and Technical Contact:</p>
          <ul>
            <li><strong>Service Operator:</strong> Innova Group Azerbaijan, Baku, Azerbaijan</li>
            <li><strong>Platform:</strong> Helmer Strategy OS</li>
            <li><strong>Official Internet Information Resource:</strong> <a href="https://helmeros.com">helmeros.com</a></li>
            <li><strong>Privacy and Legal Affairs Contact:</strong> <a href="mailto:support@helmeros.com">support@helmeros.com</a></li>
          </ul>
          <p>© 2026 Innova Group Azerbaijan / Helmer Strategy OS. All rights reserved.</p>
        </div>

        <div class="legal-doc-precedence">
          <p><strong>Governing Language Precedence:</strong> This document is translated from the original Azerbaijani version for convenience. In the event of any conflict, discrepancy, ambiguity, or dispute between this English translation and the original Azerbaijani text, the original Azerbaijani version shall govern and prevail.</p>
        </div>
      `,
    },
  },
};

/**
 * Get active language code ('az' or 'en').
 */
export function getLanguage() {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LANGUAGES.has(stored)) {
      return stored;
    }
  } catch { }
  return DEFAULT_LANGUAGE;
}

/**
 * Set active language code and dispatch change event.
 * @param {'az' | 'en'} [lang]
 * @param {boolean} [persist=true]
 */
export function setLanguage(lang, persist = true) {
  const target = SUPPORTED_LANGUAGES.has(lang) ? lang : DEFAULT_LANGUAGE;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, target);
    } catch { }
  }
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = target;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("helmer:language-change", { detail: { language: target } }));
  }
  return target;
}

/**
 * Lookup a localized string by key with dot-notation and parameter replacement.
 * Example: t('strategy.versionBadge', { version: 2 })
 * @param {string} key
 * @param {Record<string, any>} [params]
 * @param {string} [lang]
 * @returns {string}
 */
export function t(key, params = {}, lang = null) {
  const currentLang = lang && SUPPORTED_LANGUAGES.has(lang) ? lang : getLanguage();
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS[DEFAULT_LANGUAGE];
  const fallbackDict = TRANSLATIONS[DEFAULT_LANGUAGE];

  const value = resolveKey(dict, key) ?? resolveKey(fallbackDict, key) ?? key;

  if (typeof value !== "string") {
    return String(value ?? key);
  }

  return interpolate(value, params);
}

function resolveKey(obj, path) {
  if (!obj || typeof obj !== "object") return null;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }
  return current;
}

function interpolate(text, params) {
  if (!params || typeof params !== "object") return text;
  return text.replace(/\{(\w+)\}/g, (match, paramName) => {
    return paramName in params ? String(params[paramName]) : match;
  });
}

/**
 * Localized date formatter.
 * @param {Date | string | number} date
 * @param {Intl.DateTimeFormatOptions} [options]
 * @param {string} [lang]
 * @returns {string}
 */
export function formatDate(date, options = {}, lang = null) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  const resolvedLang = typeof options === "string" ? options : lang;
  const resolvedOpts = typeof options === "object" && options !== null ? options : {};

  const currentLang = resolvedLang && SUPPORTED_LANGUAGES.has(resolvedLang) ? resolvedLang : getLanguage();
  const locale = currentLang === "en" ? "en-US" : "az-AZ";

  const defaultOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  };

  return new Intl.DateTimeFormat(locale, { ...defaultOptions, ...resolvedOpts }).format(d);
}

/**
 * Localized time formatter.
 * @param {Date | string | number} date
 * @param {Intl.DateTimeFormatOptions | string} [options]
 * @param {string} [lang]
 * @returns {string}
 */
export function formatTime(date, options = {}, lang = null) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  const resolvedLang = typeof options === "string" ? options : lang;
  const resolvedOpts = typeof options === "object" && options !== null ? options : {};

  const currentLang = resolvedLang && SUPPORTED_LANGUAGES.has(resolvedLang) ? resolvedLang : getLanguage();
  const locale = currentLang === "en" ? "en-US" : "az-AZ";

  const defaultOptions = {
    hour: "2-digit",
    minute: "2-digit",
  };

  return new Intl.DateTimeFormat(locale, { ...defaultOptions, ...resolvedOpts }).format(d);
}

/**
 * Relative time formatter with localized terms ("just now", "5m ago", etc.).
 * @param {Date | string | number} date
 * @param {string} [lang]
 * @returns {string}
 */
export function formatRelativeTime(date, lang = null) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 45) {
    return t("time.justNow", {}, lang);
  }
  if (diffMin < 60) {
    return t("time.minutesAgo", { count: diffMin }, lang);
  }
  if (diffHour < 24) {
    return t("time.hoursAgo", { count: diffHour }, lang);
  }
  if (diffDay === 1) {
    return t("time.yesterday", {}, lang);
  }
  if (diffDay < 7) {
    return t("time.daysAgo", { count: diffDay }, lang);
  }
  return formatDate(d, { year: "numeric", month: "short", day: "numeric" }, lang);
}

/**
 * Number formatter with active locale.
 * @param {number} num
 * @param {Intl.NumberFormatOptions | string} [options]
 * @param {string} [lang]
 * @returns {string}
 */
export function formatNumber(num, options = {}, lang = null) {
  const resolvedLang = typeof options === "string" ? options : lang;
  const resolvedOpts = typeof options === "object" && options !== null ? options : {};

  const currentLang = resolvedLang && SUPPORTED_LANGUAGES.has(resolvedLang) ? resolvedLang : getLanguage();
  const locale = currentLang === "en" ? "en-US" : "az-AZ";
  return new Intl.NumberFormat(locale, resolvedOpts).format(Number(num) || 0);
}

// Initialize html lang attribute on module load
try {
  const activeLang = getLanguage();
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = activeLang;
  }
} catch { }
