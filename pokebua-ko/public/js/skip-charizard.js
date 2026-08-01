(() => {
  const NAME_SHOW_AT = 6.1;
  const END_HOLD_MS = 1100;
  const CLOSE_ANIMATION_MS = 450;

  let scene = null;
  let closeTimer = null;
  let playing = false;

  function formatName(value) {
    const name = String(value ?? "").trim();

    if (!name) {
      return "KUNDE";
    }

    return name.toUpperCase();
  }

  function createScene() {
    if (scene) {
      return scene;
    }

    scene = document.createElement("div");
    scene.id = "skipCharizard";
    scene.className = "skip-charizard";
    scene.setAttribute("aria-hidden", "true");

    scene.innerHTML = `
      <div class="skip-charizard-frame">

        <div class="skip-charizard-top">
          <span>★</span>
          <strong>POKEBUA ALERT</strong>
          <span>★</span>
        </div>

        <div class="skip-charizard-video-area">
          <video
    class="skip-charizard-video"
    src="/assets/skip-charizard.mp4.mp4?v=1"
    muted
    autoplay
    playsinline
    preload="auto"
></video>

          <div class="skip-charizard-name-box">
            <span class="skip-charizard-name">
              KUNDE
            </span>
          </div>

          <div class="skip-charizard-flash"></div>
        </div>

        <div class="skip-charizard-bottom">
          POWERED BY POKEBUA
        </div>

      </div>
    `;

    document.body.appendChild(scene);

    const video = scene.querySelector(
      ".skip-charizard-video"
    );

    video.addEventListener("timeupdate", () => {
      if (video.currentTime >= NAME_SHOW_AT) {
        scene.classList.add("show-name");
      }
    });

    video.addEventListener("ended", () => {
      scene.classList.add("video-ended");

      clearTimeout(closeTimer);

      closeTimer = setTimeout(() => {
        stop();
      }, END_HOLD_MS);
    });

    video.addEventListener("error", () => {
      console.error(
        "Kunne ikke laste /assets/skip-charizard.mp4",
        video.error
      );
    });

    return scene;
  }

  function reset() {
    const currentScene = createScene();
    const video = currentScene.querySelector(
      ".skip-charizard-video"
    );

    clearTimeout(closeTimer);

    currentScene.classList.remove(
      "visible",
      "show-name",
      "video-ended",
      "closing"
    );

    currentScene.setAttribute("aria-hidden", "true");

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

    playing = false;
  }

  function stop() {
    const currentScene = createScene();

    clearTimeout(closeTimer);

    currentScene.classList.add("closing");

    setTimeout(() => {
      reset();
    }, CLOSE_ANIMATION_MS);
  }

  async function play(name) {
    const currentScene = createScene();

    const video = currentScene.querySelector(
      ".skip-charizard-video"
    );

    const nameElement = currentScene.querySelector(
      ".skip-charizard-name"
    );

    clearTimeout(closeTimer);

    if (playing) {
      reset();
    }

    playing = true;

    currentScene.classList.remove(
      "visible",
      "show-name",
      "video-ended",
      "closing"
    );

    nameElement.textContent = formatName(name);

    video.pause();
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    try {
      video.currentTime = 0;
    } catch (error) {
      console.warn(
        "Kunne ikke starte videoen fra begynnelsen:",
        error
      );
    }

    void currentScene.offsetWidth;

    currentScene.setAttribute("aria-hidden", "false");
    currentScene.classList.add("visible");

    try {
      await video.play();
    } catch (error) {
      console.warn(
        "Første avspillingsforsøk feilet:",
        error
      );

      setTimeout(() => {
        video.play().catch(secondError => {
          console.error(
            "Videoen kunne ikke spilles:",
            secondError
          );

          stop();
        });
      }, 150);
    }
  }

  createScene();

  window.PokebuaSkipScene = {
    play,
    stop
  };
})();
