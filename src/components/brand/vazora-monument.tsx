"use client";

import { useEffect, useId, useRef } from "react";

import type { VerificationState } from "@/components/brand/threads";
import { useReducedMotionSafe } from "@/lib/hooks";

export function VazoraMonument({
  state,
  playing,
  step,
  duration = 600,
  mirrored = false,
  onReady,
}: {
  state: VerificationState;
  playing: boolean;
  step: number;
  duration?: number;
  mirrored?: boolean;
  onReady?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const input = useRef({ state, playing, step, duration, onReady });
  const invalidate = useRef<(() => void) | null>(null);
  const reduce = useReducedMotionSafe();
  const id = useId().replace(/:/g, "");

  useEffect(() => {
    input.current = { state, playing, step, duration, onReady };
    invalidate.current?.();
  }, [state, playing, step, duration, onReady]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    element.dataset.rendering = "loading";
    let disposed = false;
    let clean = () => {};

    const load = async () => {
      const [THREE, { RoomEnvironment }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
      ]);
      if (disposed) return;

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      if (!context) {
        element.dataset.rendering = "fallback";
        input.current.onReady?.();
        return;
      }

      const renderer = new THREE.WebGLRenderer({
        canvas,
        context,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.25;

      const geometries: import("three").BufferGeometry[] = [];
      const materials: import("three").Material[] = [];
      let environment: import("three").WebGLRenderTarget | undefined;

      const release = () => {
        geometries.forEach((g) => g.dispose());
        materials.forEach((m) => m.dispose());
        environment?.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
      };
      clean = release;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
      camera.position.set(0, 0.2, 8.4);
      camera.lookAt(0, -0.15, 0);

      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      try {
        environment = pmrem.fromScene(room, 0.04);
      } finally {
        room.dispose();
        pmrem.dispose();
      }
      scene.environment = environment.texture;

      const sculpture = new THREE.Group();
      const orientation = mirrored ? -1 : 1;
      sculpture.rotation.set(0.18, -0.28 * orientation, -0.02 * orientation);
      sculpture.scale.x = orientation;
      scene.add(sculpture);

      // Deep, dark luxury smoked mineral titanium with luminous clearcoat
      const bodyMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x223229,
        metalness: 0.94,
        roughness: 0.2,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
        reflectivity: 0.95,
        envMapIntensity: 2.2,
      });

      const sheenPosition = { value: -4 };
      const sheenStrength = { value: 0 };
      bodyMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uSheenPosition = sheenPosition;
        shader.uniforms.uSheenStrength = sheenStrength;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vMineralPosition;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMineralPosition = position;");
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vMineralPosition;\nuniform float uSheenPosition;\nuniform float uSheenStrength;",
          )
          .replace(
            "#include <opaque_fragment>",
            "float mineralBand = exp(-pow((vMineralPosition.x + vMineralPosition.y * 0.4 - uSheenPosition) * 4.5, 2.0));\noutgoingLight += vec3(0.65, 0.95, 0.8) * mineralBand * uSheenStrength * smoothstep(0.1, 0.35, vMineralPosition.z);\n#include <opaque_fragment>",
          );
      };
      bodyMaterial.customProgramCacheKey = () => "vazora-luxury-mineral-v2";

      const sourceMaterial = new THREE.MeshBasicMaterial({ color: 0xf1f7f2 });
      const evidenceMaterial = new THREE.MeshBasicMaterial({ color: 0x65c59a });
      const grooveMaterial = new THREE.MeshBasicMaterial({ color: 0x111b15 });
      const junctionGlowMaterial = new THREE.MeshStandardMaterial({
        color: 0x65c59a,
        emissive: 0x65c59a,
        emissiveIntensity: 0.8,
        roughness: 0.1,
        metalness: 0.5,
      });

      materials.push(
        bodyMaterial,
        sourceMaterial,
        evidenceMaterial,
        grooveMaterial,
        junctionGlowMaterial,
      );

      // Heavy 3D architectural chiseled extrusion
      const shapeMesh = (points: number[][]) => {
        const shape = new THREE.Shape();
        points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
        shape.closePath();
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: 0.52,
          bevelEnabled: true,
          bevelThickness: 0.055,
          bevelSize: 0.045,
          bevelSegments: 4,
          steps: 1,
          curveSegments: 1,
        });
        geometry.translate(0, 0, -0.26);
        geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, bodyMaterial);
        sculpture.add(mesh);
        return mesh;
      };

      const left = shapeMesh([[-1.75, 1.6], [-1.22, 1.6], [0, -1.2], [0, -1.82]]);
      const right = shapeMesh([[1.75, 1.6], [1.22, 1.6], [0, -1.2], [0, -1.82]]);
      const joined = shapeMesh([
        [-1.75, 1.6],
        [-1.22, 1.6],
        [0, -1.2],
        [1.22, 1.6],
        [1.75, 1.6],
        [0, -1.82],
      ]);

      const leftPath = new THREE.LineCurve3(
        new THREE.Vector3(-1.48, 1.5, 0.315),
        new THREE.Vector3(-0.02, -1.48, 0.315),
      );
      const rightPath = new THREE.LineCurve3(
        new THREE.Vector3(1.48, 1.5, 0.315),
        new THREE.Vector3(0.02, -1.48, 0.315),
      );

      const tube = (
        path: import("three").Curve<import("three").Vector3>,
        radius: number,
        material: import("three").Material,
      ) => {
        const geometry = new THREE.TubeGeometry(path, 64, radius, 8, false);
        geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, material);
        sculpture.add(mesh);
        return mesh;
      };

      const leftGroove = tube(leftPath, 0.024, grooveMaterial);
      const rightGroove = tube(rightPath, 0.024, grooveMaterial);
      const leftThread = tube(leftPath, 0.011, sourceMaterial);
      const rightThread = tube(rightPath, 0.011, evidenceMaterial);
      const seam = tube(
        new THREE.LineCurve3(leftPath.getPoint(1), rightPath.getPoint(1)),
        0.011,
        evidenceMaterial,
      );
      [leftThread, rightThread, seam].forEach((m) => {
        m.position.z = 0.022;
      });

      // Luminous convergence jewel at bottom junction
      const jewelGeo = new THREE.OctahedronGeometry(0.09, 0);
      geometries.push(jewelGeo);
      const junctionJewel = new THREE.Mesh(jewelGeo, junctionGlowMaterial);
      junctionJewel.position.set(0, -1.5, 0.34);
      sculpture.add(junctionJewel);

      const pointGeometry = new THREE.SphereGeometry(0.042, 14, 10);
      geometries.push(pointGeometry);
      const inspectionMaterial = new THREE.MeshBasicMaterial({ color: 0x8de0ba });
      materials.push(inspectionMaterial);
      const inspection = new THREE.Mesh(pointGeometry, inspectionMaterial);
      sculpture.add(inspection);

      // Studio 3D lights: dramatic high-contrast key & luminous emerald rim
      const keyLight = new THREE.DirectionalLight(0xf5fbf6, 3.4);
      keyLight.position.set(-4, 6, 6);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x65c59a, 2.8);
      rimLight.position.set(5, 3, -3);
      scene.add(rimLight);

      const fillLight = new THREE.DirectionalLight(0x406050, 1.2);
      fillLight.position.set(0, -5, 4);
      scene.add(fillLight);

      element.appendChild(canvas);

      let frame = 0;
      let visible = true;
      let lost = false;
      let pointerX = 0;
      let pointerY = 0;
      let lastTime = 0;
      let lastStep = -1;
      let phaseTime = 0;
      let gap = input.current.state === "verified" ? 0 : 0.2;
      let startingGap = gap;
      let announced = false;

      const ease = (v: number) => v * v * (3 - 2 * v);

      const draw = (time: number) => {
        frame = 0;
        if (disposed || lost || !visible || document.hidden) return;
        if (lastTime && time - lastTime < 24) {
          frame = requestAnimationFrame(draw);
          return;
        }
        const delta = lastTime ? Math.min(time - lastTime, 50) : 0;
        lastTime = time;

        const current = input.current;
        const moving = current.playing && !reduce;
        const changed = current.step !== lastStep;

        if (changed) {
          lastStep = current.step;
          phaseTime = moving ? 0 : 1600;
          startingGap = gap;
        } else if (moving) {
          phaseTime += delta;
        }

        const verified = current.state === "verified";
        const inspecting = ["verifying", "reverifying"].includes(current.state);
        const issue = ["partial", "requested", "resubmitted", "reverifying"].includes(current.state);
        const incoming = current.step === 1 || current.step === 3 || current.step === 7;

        const sweepDuration = Math.max(180, Math.min(550, current.duration * 0.75));
        const targetGap = verified ? 0 : 0.2;

        if (reduce || (!moving && changed)) {
          gap = targetGap;
        } else if (moving) {
          gap = startingGap + (targetGap - startingGap) * ease(Math.min(phaseTime / 500, 1));
        }
        if (Math.abs(gap - targetGap) < 0.0001) gap = targetGap;

        const assembled = verified && gap === 0;
        left.visible = right.visible = !assembled;
        joined.visible = seam.visible = assembled;

        [left, leftGroove, leftThread].forEach((mesh) => {
          mesh.position.x = -gap;
        });
        [right, rightGroove, rightThread].forEach((mesh) => {
          mesh.position.x = gap;
        });

        junctionJewel.visible = verified;
        if (verified) {
          junctionJewel.rotation.y = time * 0.002;
          junctionJewel.rotation.z = time * 0.001;
          junctionGlowMaterial.emissiveIntensity = 1.0 + Math.sin(time * 0.006) * 0.3;
        }

        const progress = ease(Math.min(phaseTime / sweepDuration, 1));
        const sourceProgress = current.step < 1 ? 0 : current.step === 1 ? progress : 1;
        const evidenceProgress = current.step < 3 ? 0 : incoming || inspecting ? progress : 1;

        const reveal = (geometry: import("three").BufferGeometry, amount: number) => {
          const count = geometry.index?.count ?? 0;
          geometry.setDrawRange(0, Math.floor((count * amount) / 6) * 6);
        };
        reveal(leftThread.geometry, sourceProgress);
        reveal(rightThread.geometry, evidenceProgress);

        evidenceMaterial.color.setHex(issue ? 0xd4a24a : verified ? 0x65c59a : 0x7fa995);

        inspection.visible = (incoming && phaseTime < sweepDuration) || inspecting;
        inspection.position.copy(
          (current.step === 1 ? leftPath : rightPath).getPoint(
            reduce && inspecting ? 0.6 : Math.min(progress, 0.96),
          ),
        );
        inspection.position.x += current.step === 1 ? -gap : gap;
        inspection.position.z += 0.025;
        inspection.scale.setScalar(inspection.visible && !reduce ? 1 + Math.sin(time * 0.008) * 0.16 : 1);

        // Luxurious metallic sheen traversal on state changes
        const sweeping = moving && (incoming || inspecting || current.step === 9) && phaseTime < 750;
        sheenPosition.value = sweeping
          ? -3.5 + 7 * ease(Math.min(phaseTime / 650, 1))
          : pointerX * 6.5;
        sheenStrength.value = reduce ? 0 : sweeping ? 1.0 : Math.abs(pointerX) > 0.02 ? 0.45 : 0;

        // Interactive 3D tilt with deep perspective parallax
        const targetY = -0.28 * orientation + (reduce ? 0 : pointerX * 0.18);
        const targetX = 0.18 + (reduce ? 0 : pointerY * 0.12);
        sculpture.rotation.y += (targetY - sculpture.rotation.y) * 0.14;
        sculpture.rotation.x += (targetX - sculpture.rotation.x) * 0.14;

        renderer.render(scene, camera);

        element.dataset.rendering = "ready";
        if (!announced) {
          announced = true;
          input.current.onReady?.();
        }
        element.dataset.assembly = assembled ? "closed" : verified ? "joining" : "open";
        element.dataset.gapDistance = (gap * 2).toFixed(4);

        const settling =
          Math.abs(targetY - sculpture.rotation.y) + Math.abs(targetX - sculpture.rotation.x) >
          0.0002;
        const transitioning =
          moving &&
          phaseTime < 1200 &&
          (incoming || inspecting || gap !== targetGap || sweeping);

        if (transitioning || settling) frame = requestAnimationFrame(draw);
      };

      const requestDraw = () => {
        if (!frame && !disposed && visible && !document.hidden && !lost) {
          lastTime = 0;
          frame = requestAnimationFrame(draw);
        }
      };
      invalidate.current = requestDraw;

      const resize = new ResizeObserver(() => {
        const { width, height } = element.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        requestDraw();
      });
      resize.observe(element);

      const intersection = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) requestDraw();
        else {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      });
      intersection.observe(element);

      const pointer = (event: PointerEvent) => {
        if (reduce || event.pointerType !== "mouse") return;
        const bounds = element.getBoundingClientRect();
        pointerX = (event.clientX - bounds.left) / bounds.width - 0.5;
        pointerY = (event.clientY - bounds.top) / bounds.height - 0.5;
        requestDraw();
      };
      const leave = () => {
        pointerX = 0;
        pointerY = 0;
        requestDraw();
      };
      const visibility = () => {
        if (document.hidden) {
          cancelAnimationFrame(frame);
          frame = 0;
        } else requestDraw();
      };

      const contextLost = (event: Event) => {
        event.preventDefault();
        lost = true;
        cancelAnimationFrame(frame);
        frame = 0;
        element.dataset.rendering = "fallback";
      };
      const contextRestored = () => {
        lost = false;
        requestDraw();
      };

      element.addEventListener("pointermove", pointer);
      element.addEventListener("pointerleave", leave);
      document.addEventListener("visibilitychange", visibility);
      canvas.addEventListener("webglcontextlost", contextLost);
      canvas.addEventListener("webglcontextrestored", contextRestored);

      clean = () => {
        invalidate.current = null;
        cancelAnimationFrame(frame);
        resize.disconnect();
        intersection.disconnect();
        element.removeEventListener("pointermove", pointer);
        element.removeEventListener("pointerleave", leave);
        document.removeEventListener("visibilitychange", visibility);
        canvas.removeEventListener("webglcontextlost", contextLost);
        canvas.removeEventListener("webglcontextrestored", contextRestored);
        release();
      };
      requestDraw();
    };

    load().catch(() => {
      if (!disposed) {
        clean();
        element.dataset.rendering = "fallback";
        input.current.onReady?.();
      }
    });
    return () => {
      disposed = true;
      clean();
    };
  }, [reduce, mirrored]);

  const verified = state === "verified";
  return (
    <div
      ref={host}
      className="vazora-monument"
      data-proof-state={state}
      data-gap-open={!verified}
      data-mirrored={mirrored}
      aria-hidden="true"
    >
      <svg className="monument-fallback" viewBox="0 0 600 560" fill="none">
        <defs>
          <linearGradient id={`${id}-metal`} x1="110" y1="60" x2="460" y2="450" gradientUnits="userSpaceOnUse">
            <stop stopColor="#b9c5b5" />
            <stop offset=".28" stopColor="#435b4b" />
            <stop offset=".75" stopColor="#253a2f" />
            <stop offset="1" stopColor="#677d6e" />
          </linearGradient>
        </defs>
        <g transform={`translate(${verified ? 0 : -14} 0)`}>
          <path d="M120 100h48l140 310v64Z" fill="#1b2b22" />
          <path d="M112 92h48l140 310v64Z" fill={`url(#${id}-metal)`} stroke="#65c59a" strokeOpacity="0.5" />
          <path d="M136 106 300 436" stroke={step >= 1 ? "#dce5d8" : "#2f4738"} strokeWidth="2.5" />
        </g>
        <g transform={`translate(${verified ? 0 : 14} 0)`}>
          <path d="M496 100h-48L308 410v64Z" fill="#1b2b22" />
          <path d="M488 92h-48L300 402v64Z" fill={`url(#${id}-metal)`} stroke="#65c59a" strokeOpacity="0.5" />
          <path
            d="M464 106 300 436"
            stroke={verified ? "#65c59a" : step >= 5 ? "#d4a24a" : "#7fa995"}
            strokeWidth="2.5"
            opacity={step >= 3 ? 1 : 0.3}
          />
        </g>
      </svg>
    </div>
  );
}
