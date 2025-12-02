import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import { VRM, VRMUtils } from "@pixiv/three-vrm";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { remapMixamoAnimationToVrm } from './remapMixamoAnimationToVrm';
import { VRMExpressionPresetName } from '@pixiv/three-vrm';

let renderer = null;
let scene = null;
let camera = null;
let loader = null;

function getLoader() {
  if (!loader) {
    loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
  }
  return loader;
}

function getRenderer(canvas) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  return renderer;
}

function getScene() {
  if (!scene) {
    scene = new THREE.Scene();

    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(1, 5, 2);
    scene.add(light);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  }
  return scene;
}

function getCamera() {
  if (!camera) {
    camera = new THREE.PerspectiveCamera(
      35,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 1, 3);
  }
  return camera;
}

export default function VRMModel({animation, mouthMovement}) {
  const canvasRef = useRef(null);
  const vrmRef = useRef(null);
  const rafRef = useRef(null);
  const mixerRef = useRef(null);
  const actionRef = useRef(null);
  const pendingAnimationRef = useRef(null);
  const fbxLoaderRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const mouthMovementRef = useRef(false);

  useEffect(() => {
    mouthMovementRef.current = mouthMovement;
  }, [mouthMovement]);

  // STUFF TO BE MOUNTED ONLY ONCE
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // RENDERER, SCENE, CAMERA
    const renderer = getRenderer(canvas);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    const scene = getScene();
    const camera = getCamera();

    // LOADING VRM
    const loader = getLoader();
    let vrmCancelled = false;
    if (!fbxLoaderRef.current) fbxLoaderRef.current = new FBXLoader();

    loader.load(
      "/models/avatar.vrm",
      (gltf) => {
        if (vrmCancelled) {
          // If component unmounted before load finished, try to dispose and return
          try {
            if (gltf.scene) VRMUtils.deepDispose(gltf.scene);
          } catch (e) {}
          return;
        }
        const vrm = gltf.userData.vrm;
        vrmRef.current = vrm;
        vrm.scene.rotation.y = Math.PI;
        vrm.scene.traverse((o) => (o.frustumCulled = false));
        scene.add(vrm.scene);
        mixerRef.current = new THREE.AnimationMixer(vrm.scene);

        const pending = pendingAnimationRef.current;
        if (pending) {
          loadAndApplyAnimation(pending);
          pendingAnimationRef.current = null;
        }
      },
      undefined,
      (err) => console.error("Failed loading VRM", err));

    function animate() {
      rafRef.current = requestAnimationFrame(animate);
      const dt = clockRef.current.getDelta();

      if (!vrmRef.current) return;
      if (typeof vrmRef.current.update === "function") {
        vrmRef.current.update(dt);
      }
      if (mouthMovementRef.current) {
        const t = clockRef.current.getElapsedTime();
        const v = (Math.sin(t * 5) + 1) / 2;

        vrmRef.current.scene.traverse(obj => {
          if (obj.isSkinnedMesh && obj.morphTargetDictionary) {
            const dict = obj.morphTargetDictionary;
            const keys = ["Fcl_MTH_A","Fcl_MTH_O","Fcl_MTH_U","Fcl_MTH_E","Fcl_MTH_I"];
            keys.forEach(key => {
              if (dict[key] !== undefined) {
                obj.morphTargetInfluences[dict[key]] = v * (key === "Fcl_MTH_A" ? 0.75 : key === "Fcl_MTH_O" ? 0.4 : key === "Fcl_MTH_U" ? 0.2 : key === "Fcl_MTH_E" ? 0.2 : 0.2);
              }
            });
          }
        });
      }
      if (mixerRef.current) mixerRef.current.update(dt);
      renderer.render(scene, camera);
    }
    animate();

    // RESIZE HANDLER
    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
    window.addEventListener("resize", onResize);

    // CLEANUP
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafRef.current);
      vrmCancelled = true;

      if (actionRef.current) {
        try { actionRef.current.stop(); } catch (e) {}
        actionRef.current = null;
      }
      if (mixerRef.current) {
        try { mixerRef.current.stopAllAction(); } catch (e) {}
        mixerRef.current = null;
      }

      if (vrmRef.current) {
        const root = vrmRef.current.scene;
        if (root) {
          try {
            scene.remove(root);
            VRMUtils.deepDispose(root);
          } catch (e) {
            console.warn("Safe dispose ignored", e);
          }
        }
        vrmRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!animation) return;

    if (!vrmRef.current || !mixerRef.current) {
      pendingAnimationRef.current = animation;
      return;
    }

    loadAndApplyAnimation(animation);
  }, [animation]);

  function loadAndApplyAnimation(animName) {
    const fbxLoader = fbxLoaderRef.current || (fbxLoaderRef.current = new FBXLoader());
    const vrm = vrmRef.current;
    const mixer = mixerRef.current;
    if (!vrm || !mixer) {
      pendingAnimationRef.current = animName;
      return;
    }

    const url = `/mixamo/${animName}.fbx`;
    fbxLoader.load(
      url,
      (fbx) => {
        if (!vrmRef.current) return;

        const vrmClip = remapMixamoAnimationToVrm(vrmRef.current, fbx);

        const cleanTracks = vrmClip.tracks.filter(track => track.name.endsWith('.quaternion'));
        const clip = new THREE.AnimationClip(vrmClip.name || animName, vrmClip.duration, cleanTracks);

        const newAction = mixer.clipAction(clip);
        newAction.setLoop(THREE.LoopRepeat, Infinity);
        newAction.clampWhenFinished = false;
        newAction.enabled = true;

        const prevAction = actionRef.current;
        const FADE = 0.25;

        if (prevAction && prevAction !== newAction) {
          try {
            prevAction.fadeOut(FADE);
          } catch (e) {
            try { prevAction.stop(); } catch {}
          }
        }

        newAction.reset();
        newAction.fadeIn(FADE);
        newAction.play();

        actionRef.current = newAction;
      },
      undefined,
      (err) => {
        console.error("Failed loading FBX:", url, err);
      }
    );
  }

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
