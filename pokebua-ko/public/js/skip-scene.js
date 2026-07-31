(() => {
  const SIGN_DURATION = 1400;

  let rootElement = null;
  let hideTimer = null;

  function cleanName(value) {
    const name = String(value ?? "").trim();

    if (!name) {
      return "Kunde";
    }

    return name.split(/\s+/)[0];
  }

  function buildScene() {
    if (rootElement) {
      return rootElement;
    }

    rootElement = document.createElement("div");
    rootElement.id = "skipScene";
    rootElement.className = "skipscene";
    rootElement.setAttribute("aria-hidden", "true");

    rootElement.innerHTML = `
      <div class="skipscene-media">
        <video
          class="skipscene-video"
          src="/assets/skip-scene.mp4"
          muted
          autoplay
          playsinline
          preload="auto"
        ></video>
      </div>

      <div class="skipscene-sign-wrap">
        <div class="skipscene-sign">
          <div class="skipscene-title">
            SKIP THE LINE
          </div>

          <div
            id="skipSceneName"
            class="skipscene-name"
          >
            Kunde
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(rootElement);

    return rootElement;
  }

  function clearTimers() {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  function stop() {
    clearTimers();

    const scene = buildScene();
    const video = scene.querySelector(".skipscene-video");

    if (video) {
      video.pause();
      video.currentTime = 0;
    }

    scene.classList.remove("show", "show-sign");
    scene.setAttribute("aria-hidden", "true");
  }

  async function play(name) {
    const scene = buildScene();
    const video = scene.querySelector(".skipscene-video");
    const nameElement = scene.querySelector("#skipSceneName");

    clearTimers();

    scene.classList.remove("show", "show-sign");
    scene.setAttribute("aria-hidden", "true");

    if (nameElement) {
      nameElement.textContent = cleanName(name);
    }

    if (!video) {
      console.error("Fant ikke Skip the Line-videoen.");
      return;
    }

    video.pause();
    video.currentTime = 0;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    video.onended = () => {
      scene.classList.add("show-sign");

      hideTimer = setTimeout(() => {
        stop();
      }, SIGN_DURATION);
    };

    video.onerror = () => {
      console.error(
        "Kunne ikke laste /assets/skip-scene.mp4"
      );
    };

    void scene.offsetWidth;

    scene.setAttribute("aria-hidden", "false");
    scene.classList.add("show");

    try {
      await video.play();
    } catch (error) {
      console.warn(
        "Første avspillingsforsøk feilet. Prøver igjen:",
        error
      );

      setTimeout(() => {
        video.play().catch(secondError => {
          console.error(
            "Videoen kunne ikke startes automatisk:",
            secondError
          );
        });
      }, 100);
    }
  }

  buildScene();

  window.PokebuaSkipScene = {
    play,
    stop
  };
})();
