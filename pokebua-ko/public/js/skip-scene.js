(() => {
  /*
   * Videoen varer omtrent 8 sekunder.
   * Navnet vises når videoen har kommet til 6,15 sekunder.
   *
   * Juster denne dersom navnet dukker opp for tidlig eller sent.
   */
  const NAME_SHOW_AT = 6.15;

  /*
   * Hvor lenge hele rammen blir stående etter at videoen er ferdig.
   */
  const END_HOLD_DURATION = 1200;

  let rootElement = null;
  let hideTimer = null;
  let isPlaying = false;

  function cleanName(value) {
    const name = String(value ?? "").trim();

    if (!name) {
      return "Kunde";
    }

    return name;
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
      <div class="skipscene-frame">

        <div class="skipscene-frame-glow"></div>

        <div class="skipscene-header">
          <span class="skipscene-header-star">★</span>
          <span>POKEBUA ALERT</span>
          <span class="skipscene-header-star">★</span>
        </div>

        <div class="skipscene-video-wrap">

          <video
            class="skipscene-video"
            src="/assets/skip-scene.mp4"
            muted
            autoplay
            playsinline
            preload="auto"
          ></video>

          <div class="skipscene-name-area">
            <span
              id="skipSceneName"
              class="skipscene-name"
            >
              Kunde
            </span>
          </div>

          <div class="skipscene-flash"></div>

        </div>

        <div class="skipscene-footer">
          POWERED BY POKEBUA
        </div>

      </div>
    `;

    document.body.appendChild(rootElement);

    const video = rootElement.querySelector(".skipscene-video");

    video.addEventListener("timeupdate", () => {
      if (video.currentTime >= NAME_SHOW_AT) {
        rootElement.classList.add("show-name");
      }
    });

    video.addEventListener("ended", () => {
      rootElement.classList.add("video-ended");

      hideTimer = window.setTimeout(() => {
        stop();
      }, END_HOLD_DURATION);
    });

    video.addEventListener("error", () => {
      console.error(
        "Kunne ikke laste Skip the Line-videoen:",
        video.error
      );
    });

    return rootElement;
  }

  function clearTimers() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function resetScene() {
    const scene = buildScene();
    const video = scene.querySelector(".skipscene-video");

    scene.classList.remove(
      "show",
      "show-name",
      "video-ended"
    );

    scene.setAttribute("aria-hidden", "true");

    if (video) {
      video.pause();

      try {
        video.currentTime = 0;
      } catch (error) {
        console.warn(
          "Kunne ikke nullstille videoen:",
          error
        );
      }
    }
  }

  function stop() {
    clearTimers();
    isPlaying = false;

    const scene = buildScene();

    scene.classList.add("closing");

    window.setTimeout(() => {
      scene.classList.remove("closing");
      resetScene();
    }, 500);
  }

  async function play(name) {
    const scene = buildScene();
    const video = scene.querySelector(".skipscene-video");
    const nameElement =
      scene.querySelector("#skipSceneName");

    clearTimers();

    /*
     * Dersom en ny alert kommer mens den gamle kjører,
     * starter vi den nye fra begynnelsen.
     */
    if (isPlaying) {
      resetScene();
    }

    isPlaying = true;

    if (nameElement) {
      nameElement.textContent = cleanName(name);
    }

    if (!video) {
      console.error(
        "Fant ikke Skip the Line-videoen."
      );

      isPlaying = false;
      return;
    }

    scene.classList.remove(
      "show",
      "show-name",
      "video-ended",
      "closing"
    );

    video.pause();
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    try {
      video.currentTime = 0;
    } catch (error) {
      console.warn(
        "Kunne ikke sette videoen til starten:",
        error
      );
    }

    /*
     * Tvinger nettleseren til å registrere startposisjonen,
     * slik at inn-animasjonen kjører hver gang.
     */
    void scene.offsetWidth;

    scene.setAttribute("aria-hidden", "false");
    scene.classList.add("show");

    try {
      await video.play();
    } catch (firstError) {
      console.warn(
        "Første avspillingsforsøk feilet. Prøver igjen:",
        firstError
      );

      window.setTimeout(() => {
        video.play().catch(secondError => {
          console.error(
            "Videoen kunne ikke startes:",
            secondError
          );

          stop();
        });
      }, 150);
    }
  }

  buildScene();

  window.PokebuaSkipScene = {
    play,
    stop
  };
})();
