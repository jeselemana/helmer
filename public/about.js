const ASK_DIAGRAM_STEPS = {
  hypothesis: {
    arc: "M 28 64 C 95 22, 165 22, 230 64",
    activeDots: [0, 1],
    caption: "Davamlı sessiya yaddaşı üzərindən alternativ ssenarilərin modelləşdirilməsi.",
  },
  grounding: {
    arc: "M 28 64 C 95 22, 165 22, 230 64 C 258 82, 278 92, 298 92",
    activeDots: [0, 1, 2],
    caption: "Təcrid olunmuş Google Search Grounding ilə real-vaxt mənbə təsdiqlənməsi.",
  },
  synthesis: {
    arc: "M 28 64 C 95 22, 165 22, 230 64 C 295 106, 365 106, 432 64",
    activeDots: [0, 1, 2, 3],
    caption: "Çoxaddımlı strateji arqumentasiyanın icra üçün hazır çıxarışa çevrilməsi.",
  },
};

const BUILD_DIAGRAM_NODES = {
  intent: {
    path: "M 24 64 L 146 64",
    activeKeys: ["intent"],
    caption: "Strateji məqsəd şifrələnmiş kontekst ilə qəbul edilir və icra planına çevrilir.",
  },
  orchestrator: {
    path: "M 24 64 L 146 64 C 190 64, 200 26, 244 26",
    activeKeys: ["intent", "orchestrator"],
    caption: "Orkestrator tapşırığı alt-mərhələlərə bölür və ixtisaslaşmış modellər arasında paylayır.",
  },
  agents: {
    path: "M 146 64 C 190 64, 200 26, 244 26 L 312 26 M 146 64 L 312 64 M 146 64 C 190 64, 200 102, 244 102 L 312 102",
    activeKeys: ["intent", "orchestrator", "agents"],
    caption: "Tədqiqat, modelləşdirmə və risk agentləri eyni vaxtda paralel zolaqlarda işləyir.",
  },
  output: {
    path: "M 24 64 L 434 64",
    activeKeys: ["intent", "orchestrator", "agents", "output"],
    caption: "Paralel nəticələr yoxlanılaraq vahid strateji arxitekturaya və sənədlərə birləşdirilir.",
  },
};

const TELEMETRY_MODES = {
  ask: {
    primaryLatency: "0.24 san",
    deltaNote: "· 6× daha sürətli",
    chartTitle: "Gözləmədən ilk cavabı alın",
    latencyExplain:
      "Adi çat alətləri hər yeni sualda əvvəlki yazışmaları başdan oxuduğu üçün ləngiyir. Helmer söhbətin məzmununu hazır saxlayır və ilk sözü saniyənin dörddə biri qədər müddətdə yazmağa başlayır.",
    curveExplain:
      "Qısa qeyddən 1,500 səhifəlik hesabatlara qədər — məlumat həcmi artdıqca digər sistemlər xeyli ağırlaşır, Helmer isə eyni rahat sürəti qoruyur. Nöqtələrə toxunaraq fərqi yoxlayın:",
    helmerVal: "0.24 san",
    helmerWidth: "14%",
    standardLabel: "Adi süni intellekt çatı",
    standardVal: "1.4 san",
    standardWidth: "52%",
    fragmentedLabel: "Fərqli alətlər arasında keçid",
    fragmentedVal: "2.9 san",
    fragmentedWidth: "94%",
    yLabels: ["3.0s", "2.0s", "1.0s", "0.2s"],
    helmerLine: "M 70 165 C 136 163, 206 161, 258 159 C 330 156, 430 153, 540 149",
    helmerArea: "M 70 165 C 136 163, 206 161, 258 159 C 330 156, 430 153, 540 149 L 540 170 L 70 170 Z",
    baselineLine: "M 70 164 C 136 149, 206 124, 258 102 C 320 75, 420 44, 540 24",
    points: [
      { scale: "~15 səhifə", latency: "0.21 san", y: 165 },
      { scale: "~80 səhifə", latency: "0.23 san", y: 162 },
      { scale: "~200 səhifə", latency: "0.25 san", y: 159 },
      { scale: "~400 səhifə", latency: "0.26 san", y: 156 },
      { scale: "~800 səhifə", latency: "0.28 san", y: 153 },
      { scale: "1,500+ səhifə", latency: "0.29 san", y: 149 },
    ],
  },
  build: {
    primaryLatency: "4.8 san",
    deltaNote: "· 4× daha sürətli",
    chartTitle: "Böyük işləri paralel tamamlayın",
    latencyExplain:
      "Tək bir süni intellekt modeli böyük sənədləri addım-addım növbə ilə yazır və xeyli vaxt aparır. Helmer tapşırığı hissələrə bölür — araşdırma, təhlil və sənəd tərtibatı eyni vaxtda paralel icra olunur.",
    curveExplain:
      "Yüzlərlə səhifəlik sənəd və cədvəl əsasında yeni strategiya hazırlandıqda belə paralel icra vaxtı stabil qalır və sistem tıxanmır. Nöqtələrə toxunaraq fərqi yoxlayın:",
    helmerVal: "4.8 san",
    helmerWidth: "16%",
    standardLabel: "Adi tək-model axını",
    standardVal: "18.4 san",
    standardWidth: "54%",
    fragmentedLabel: "Əl ilə hissə-hissə hazırlıq",
    fragmentedVal: "42.0 san",
    fragmentedWidth: "96%",
    yLabels: ["40s", "28s", "16s", "4s"],
    helmerLine: "M 70 163 C 136 160, 206 157, 258 154 C 330 150, 430 146, 540 141",
    helmerArea: "M 70 163 C 136 160, 206 157, 258 154 C 330 150, 430 146, 540 141 L 540 170 L 70 170 Z",
    baselineLine: "M 70 158 C 136 139, 206 112, 258 88 C 320 62, 420 38, 540 22",
    points: [
      { scale: "~15 səhifə", latency: "3.9 san", y: 163 },
      { scale: "~80 səhifə", latency: "4.3 san", y: 159 },
      { scale: "~200 səhifə", latency: "4.8 san", y: 154 },
      { scale: "~400 səhifə", latency: "5.2 san", y: 150 },
      { scale: "~800 səhifə", latency: "5.7 san", y: 146 },
      { scale: "1,500+ səhifə", latency: "6.2 san", y: 141 },
    ],
  },
};

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function initAskDiagram() {
  const tabs = document.querySelectorAll("[data-ask-step]");
  const dots = document.querySelectorAll("[data-ask-node]");
  const arcEl = document.getElementById("askActiveArc");
  if (!tabs.length) return;

  const activate = (stepKey) => {
    const config = ASK_DIAGRAM_STEPS[stepKey];
    if (!config) return;

    tabs.forEach((tab) => {
      const match = tab.getAttribute("data-ask-step") === stepKey;
      tab.classList.toggle("is-active", match);
      tab.setAttribute("aria-selected", String(match));
    });

    if (arcEl) arcEl.setAttribute("d", config.arc);

    dots.forEach((dot) => {
      const idx = Number(dot.getAttribute("data-ask-node"));
      dot.classList.toggle("is-active", config.activeDots.includes(idx));
    });

    setText("askDiagramCaption", config.caption);
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activate(tab.getAttribute("data-ask-step")));
  });
}

function initBuildDiagram() {
  const steps = document.querySelectorAll("[data-build-node]");
  const dots = document.querySelectorAll("[data-build-dot]");
  const pathEl = document.getElementById("buildActivePath");
  if (!steps.length) return;

  const selectNode = (nodeKey) => {
    const config = BUILD_DIAGRAM_NODES[nodeKey];
    if (!config) return;

    steps.forEach((btn) => {
      const match = btn.getAttribute("data-build-node") === nodeKey;
      btn.classList.toggle("is-active", match);
      btn.setAttribute("aria-selected", String(match));
    });

    if (pathEl) pathEl.setAttribute("d", config.path);

    dots.forEach((dot) => {
      const key = dot.getAttribute("data-build-dot");
      dot.classList.toggle("is-active", config.activeKeys.includes(key));
    });

    setText("buildDiagramCaption", config.caption);
  };

  steps.forEach((btn) => {
    const key = btn.getAttribute("data-build-node");
    btn.addEventListener("click", () => selectNode(key));
    btn.addEventListener("mouseenter", () => selectNode(key));
  });
}

function initTelemetryDashboard() {
  const tabs = document.querySelectorAll("[data-telemetry-mode]");
  const curveNodes = document.querySelectorAll(".curve-node");
  if (!tabs.length) return;

  let currentMode = "ask";
  let activePointIndex = 2;

  const updateReadout = (index) => {
    const modeData = TELEMETRY_MODES[currentMode];
    const point = modeData?.points?.[index];
    if (!point) return;
    activePointIndex = index;

    curveNodes.forEach((circle, idx) => {
      const isMatch = idx === index;
      circle.classList.toggle("is-active", isMatch);
      circle.setAttribute("r", isMatch ? "5" : "3.5");
    });

    setText("curveActiveReadout", `${point.scale} · ${point.latency}`);
  };

  const applyMode = (modeKey) => {
    const modeData = TELEMETRY_MODES[modeKey];
    if (!modeData) return;
    currentMode = modeKey;

    tabs.forEach((tab) => {
      const isMatch = tab.getAttribute("data-telemetry-mode") === modeKey;
      tab.classList.toggle("is-active", isMatch);
      tab.setAttribute("aria-selected", String(isMatch));
    });

    setText("kpiPrimaryLatency", modeData.primaryLatency);
    setText("latencyChartTitle", modeData.chartTitle);
    setText("latencyDeltaNote", modeData.deltaNote);
    setText("latencyExplain", modeData.latencyExplain);
    setText("curveExplain", modeData.curveExplain);

    setText("barValHelmer", modeData.helmerVal);
    setText("barLabelStandard", modeData.standardLabel);
    setText("barValStandard", modeData.standardVal);
    setText("barLabelFragmented", modeData.fragmentedLabel);
    setText("barValFragmented", modeData.fragmentedVal);

    const fillHelmer = document.getElementById("barFillHelmer");
    const fillStandard = document.getElementById("barFillStandard");
    const fillFragmented = document.getElementById("barFillFragmented");
    if (fillHelmer) fillHelmer.style.width = modeData.helmerWidth;
    if (fillStandard) fillStandard.style.width = modeData.standardWidth;
    if (fillFragmented) fillFragmented.style.width = modeData.fragmentedWidth;

    setText("yAxisTop", modeData.yLabels[0]);
    setText("yAxisMidHigh", modeData.yLabels[1]);
    setText("yAxisMidLow", modeData.yLabels[2]);
    setText("yAxisZero", modeData.yLabels[3]);

    const helmerLine = document.getElementById("helmerLinePath");
    const helmerArea = document.getElementById("helmerAreaPath");
    const baselineLine = document.getElementById("baselineCurvePath");
    if (helmerLine) helmerLine.setAttribute("d", modeData.helmerLine);
    if (helmerArea) helmerArea.setAttribute("d", modeData.helmerArea);
    if (baselineLine) baselineLine.setAttribute("d", modeData.baselineLine);

    curveNodes.forEach((circle, idx) => {
      const pt = modeData.points[idx];
      if (pt) circle.setAttribute("cy", String(pt.y));
    });

    updateReadout(activePointIndex);
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      applyMode(tab.getAttribute("data-telemetry-mode"));
    });
  });

  curveNodes.forEach((circle) => {
    const idx = Number(circle.getAttribute("data-point-index"));
    circle.addEventListener("mouseenter", () => updateReadout(idx));
    circle.addEventListener("focus", () => updateReadout(idx));
    circle.addEventListener("click", () => updateReadout(idx));
  });

  applyMode("ask");
}

function initGeminiLogoFallback() {
  const logoImg = document.getElementById("geminiOfficialLogo");
  const fallbackWrap = document.getElementById("geminiFallbackLogo");
  if (!logoImg || !fallbackWrap) return;

  const activateFallback = () => {
    logoImg.hidden = true;
    fallbackWrap.hidden = false;
  };

  logoImg.addEventListener("error", activateFallback);

  if (logoImg.complete && logoImg.naturalWidth === 0) {
    activateFallback();
  }
}

function initScrollReveal() {
  const nodes = document.querySelectorAll(".reveal-node");
  if (!nodes.length) return;

  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion || typeof IntersectionObserver !== "function") {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }

  document.documentElement.classList.add("reveal-ready");

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.1, rootMargin: "0px 0px -24px 0px" }
  );

  nodes.forEach((node) => observer.observe(node));
}

function bootstrapAboutPage() {
  initAskDiagram();
  initBuildDiagram();
  initTelemetryDashboard();
  initGeminiLogoFallback();
  initScrollReveal();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapAboutPage, { once: true });
} else {
  bootstrapAboutPage();
}
