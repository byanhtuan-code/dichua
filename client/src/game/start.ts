import { PerspectiveCamera, Scene, Vector3, type Object3D, type WebGLRenderer } from "three";
import {
  CAMERA,
  CUSHION_TOP,
  RESIDENTS,
  ROOM_CAPACITY,
  VISITOR_COLORS,
  makeName,
  pickSpawn,
  roomId,
  roomNameOf,
  roomAllowsChat,
  roomNumber,
  spaceOf,
  vnMidnight,
  type AccountView,
  type ConnectionStatus,
} from "@santinh/shared";
import { Avatar } from "../avatar/avatar.ts";
import { ContactShadows } from "../avatar/contact-shadow.ts";
import { MonkFactory } from "../avatar/monk-model.ts";
import { SpiritualEffects } from "../avatar/spiritual-effects.ts";
import { CameraRig, cameraWorldOf, pickFloor } from "../controls/camera-rig.ts";
import { Input, ownedByUi, type MoveAxes } from "../controls/input.ts";
import { Movement } from "../controls/movement.ts";
import { vi } from "../i18n/vi.ts";
import { createWalkChip } from "../ui/walk-chip.ts";
import { GESTURE_ORDER, Hud, type AvatarGestureKind, type GestureKind } from "../ui/hud.ts";
import { Joystick } from "../ui/joystick.ts";
import { ProgressionDialog } from "../ui/progression-dialog.ts";
import { RoomsDialog, emptiestRoom, roomFromSearch, writeRoomToUrl } from "../ui/rooms-dialog.ts";
import { Toasts } from "../ui/toasts.ts";
import { PeopleDialog } from "../ui/people-dialog.ts";
import { InviteAction } from "../ui/invite-action.ts";
import { InviteDialog } from "../ui/invite-dialog.ts";
import { ExitScreen } from "../ui/exit-screen.ts";
import { RestScreen } from "../ui/rest-screen.ts";
import { CeremonyBanner } from "../ui/ceremony-banner.ts";
import { SettingsDialog } from "../ui/settings-dialog.ts";
import { OfferingDialog } from "../ui/offering-dialog.ts";
import { DharmaDialog } from "../ui/dharma-dialog.ts";
import { WishTreeDialog } from "../ui/wish-tree-dialog.ts";
import { AudioEngine } from "../audio/engine.ts";
import { Chant } from "../audio/chant.ts";
import { BeadsScene } from "../beads/beads-scene.ts";
import { BeadsScreen } from "../beads/beads-screen.ts";
import { centreSlot, safeLocalStorage } from "../beads/counter.ts";
import { NameLabels } from "../ui/labels.ts";
import { createAccountApi, createDriver } from "../net/create-driver.ts";
import { clearSession, loadSession, saveSession } from "../net/session-store.ts";
import { AccountDialog, type AccountMode } from "../ui/account-dialog.ts";
import { ChatPanel } from "../ui/chat-panel.ts";
import { readNear, stripNearFromUrl } from "../net/invite.ts";
import { loadName, saveName } from "../net/name-store.ts";
import { NameDialog } from "../ui/name-dialog.ts";
import type { NetDriver } from "../net/net-driver.ts";
import { EventFilter, RemoteAvatars, labelHeight } from "../net/remote-avatars.ts";
import { FrameStats } from "../engine/frame-stats.ts";
import { Loop } from "../engine/loop.ts";
import { Quality } from "../engine/quality.ts";
import { createRenderer, isWebGLAvailable } from "../engine/renderer.ts";
import { createDebugOverlay } from "../debug/overlay.ts";
import { e2eState, installE2EHooks, type E2EState, type PerfInfo } from "../debug/e2e-hooks.ts";
import { Actions, installActionKeys } from "./actions.ts";
import { Progression } from "./progression.ts";
import { applyCameraPreset, params, registerCameraPreset } from "../debug/params.ts";
import { hideBoot, showBootError } from "../ui/boot.ts";
import { Assets } from "../world/assets.ts";
import { createEnvironment } from "../world/environment.ts";
import { buildSpace } from "../world/spaces.ts";

const FOV = 55;
const NEAR = 0.1;
const FAR = 600;
const COLOR_STORAGE_KEY = "santinh.color.v1";
const WOODBLOCK_STORAGE_KEY = "santinh.woodblock.v1";
const MAX_MERIT_FLOATS = 8;

function loadSavedColor(): string | null {
  try {
    const val = safeLocalStorage()?.getItem(COLOR_STORAGE_KEY);
    return val !== null && val !== undefined && (VISITOR_COLORS as readonly string[]).includes(val) ? val : null;
  } catch {
    return null;
  }
}

function saveSavedColor(color: string): void {
  try {
    safeLocalStorage()?.setItem(COLOR_STORAGE_KEY, color);
  } catch {
    // Private browsing or quota exceeded: session colour still works.
  }
}

function loadWoodblockCount(): number {
  try {
    const raw = safeLocalStorage()?.getItem(WOODBLOCK_STORAGE_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function saveWoodblockCount(count: number): void {
  try {
    safeLocalStorage()?.setItem(WOODBLOCK_STORAGE_KEY, String(count));
  } catch {
    // Private browsing or quota exceeded: session counter still works.
  }
}

/** Builds the engine and world. Rejects (→ boot load error) if any core asset fails. */
export async function start(): Promise<void> {
  if (!isWebGLAvailable()) {
    showBootError("webgl");
    return;
  }

  const p = params();
  const shadows = p.shadows || !p.e2e;
  const now = (): number => (p.timeOfDayMs === null ? Date.now() : vnMidnight(Date.now()) + p.timeOfDayMs);

  let loop: Loop | null = null;
  let net: NetDriver | null = null;
  let renderer: WebGLRenderer;
  try {
    renderer = createRenderer({
      shadows,
      onContextLost: () => {
        loop?.dispose();
        net?.disconnect();
        showBootError("load");
      },
    });
  } catch (err) {
    console.error(err);
    showBootError("webgl");
    return;
  }

  if (p.avatar) {
    const { startAvatarPreview } = await import("../avatar/preview.ts");
    startAvatarPreview(renderer, { debug: p.debug });
    return;
  }

  // The room decides the space (map, scenery); a room in another space means a page reload (P-D14).
  let room = roomFromSearch(location.search) ?? roomId(1);
  const space = spaceOf(room);
  document.body.dataset.space = space.theme;
  const cameraWorld = cameraWorldOf(space);
  /** True (and the page is reloading) when `id` lives in another space than the one built here. */
  const reloadIfOtherSpace = (id: string): boolean => {
    // Unknown ids (bad list from a server) stay in place; connect/switch rejects them.
    if (roomNumber(id) === null || spaceOf(id).id === space.id) return false;
    const url = new URL(location.href);
    url.searchParams.set("room", id);
    location.assign(url);
    return true;
  };

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, NEAR, FAR);
  const assets = new Assets();

  try {
    const [env, scenery] = await Promise.all([
      createEnvironment(scene, assets, { shadows, now }),
      buildSpace(space.id, { scene, assets }),
    ]);

    registerCameraPreset("spawn", {
      position: [space.spawn.x, space.groundY(space.spawn.x, space.spawn.z) + CAMERA.height, space.spawn.z + CAMERA.distance],
      target: [space.spawn.x, 1.4, space.spawn.z - 8],
    });

    // The player: own novice, real shadow; contact-shadow slot 0 is ours, the rest are for others (T9).
    const initialRobeColor = loadSavedColor() ?? VISITOR_COLORS[0] ?? "#b9c3c7";
    const factory = new MonkFactory();
    const self = new Avatar(factory.create(initialRobeColor, "full"));
    scene.add(self.object);
    const spiritualEffects = new SpiritualEffects(self.object);
    const contacts = new ContactShadows(scene, ROOM_CAPACITY + RESIDENTS.length);
    contacts.setCount(1);

    const spawn = pickSpawn(space);
    const movement = new Movement(space, spawn);
    const rig = new CameraRig(camera, spawn, cameraWorld);
    // `?cam=` screenshots keep their fixed view; the player still walks.
    const fixedCamera = applyCameraPreset(camera);
    const toasts = new Toasts();
    movement.on("invalid-floor", () => toasts.show(vi.toast.invalidFloor, "warn"));

    // Everyone else comes through the NetDriver (mock in phase 01).
    const driver = createDriver();
    net = driver;
    const savedName = loadName();
    if (savedName !== null) driver.setName(savedName);
    let status: ConnectionStatus = "connecting";
    const serverNow = (): number => Date.now() + driver.clockOffset;
    const remotes = new RemoteAvatars(scene, factory, contacts, space);

    let woodblockCount = loadWoodblockCount();
    const progression = new Progression(now, safeLocalStorage(), woodblockCount);
    const labels = new NameLabels();
    let selfId: string | null = null;
    let selfName: string | null = null;

    const syncEquippedCosmetics = (): void => {
      spiritualEffects.setAura(progression.equippedAura);
      spiritualEffects.setArtifact(progression.equippedArtifact);
      if (selfId !== null) {
        labels.setTitle(selfId, progression.equippedTitleBadge);
      }
    };
    syncEquippedCosmetics();
    progression.onChange(syncEquippedCosmetics);
    progression.onQuestComplete((def) => {
      toasts.show(`Hoàn thành nhiệm vụ: ${def.title} (+${def.reward} Công đức)`);
    });

    const actions = new Actions({
      space,
      net: driver,
      mover: movement,
      avatar: self,
      connected: () => status === "connected",
      serverNow,
      obstacles: () => remotes.obstacles,
    });
    actions.on("toast", (t) => toasts.show(t.text, t.kind));
    const audio = new AudioEngine();
    const chant = new Chant(audio, now);
    actions.on("bell", () => {
      audio.bell();
      progression.recordAction("bow", 1);
    });
    actions.on("hello", () => {
      audio.hello();
      progression.recordAction("hello", 1);
    });
    actions.on("teleport", (at) => {
      if (!fixedCamera) rig.snap(at.x, CUSHION_TOP, at.z);
    });
    installActionKeys(actions);

    const rooms = new RoomsDialog({
      net: driver,
      currentRoom: () => room,
      inRoom: () => status === "connected",
      reloadIfOtherSpace,
      onSwitched: (id) => {
        room = id;
        const rn = roomNumber(id) ?? 1;
        const rName = rooms.nameOf(id);
        hud.setRoom(rn, rName);
        settings.setRoomInfo(rn, rName);
        progressionDialog.setRoomInfo(rn, rName, status);
      },
    });
    const nameDialog = new NameDialog();
    // What the visitor picked; the room may show it as "An 2" (P3-D3).
    let myName = savedName;
    const useName = (name: string): void => {
      myName = name;
      saveName(name);
      driver.setName(name);
      settings.setName(name);
      progressionDialog.setPlayerName(name);
    };
    const renameSelf = (): void => {
      nameDialog.open("rename", myName ?? selfName ?? "Đạo Hữu", useName);
    };

    // P4-D2 / D4: the session token lives in `santinh.session`; the driver re-sends it on every socket.
    const accountApi = createAccountApi();
    const accountDialog = new AccountDialog(accountApi);
    let session = loadSession();
    /** Username on show in settings; set from the HTTP answer (register / login / me). */
    let username: string | null = null;
    const showAccount = (name: string | null): void => {
      username = name;
      settings.setAccount(name);
      chat.refresh();
    };
    /** False while the saved session is being checked: a first visit waits for it before asking a name. */
    let accountChecked = session === null;
    let firstFrameShown = false;
    const forgetSession = (): void => {
      session = null;
      clearSession();
      showAccount(null);
    };
    const applyAccount = (token: string, account: AccountView): void => {
      session = token;
      // Session first: the rename that `useName` may send then counts as the account's.
      driver.setSession(token);
      showAccount(account.username);
      useName(account.displayName);
      if (!entered) {
        entered = true;
        nameDialog.dismiss();
        if (!suspended) join();
      }
    };
    const openAccount = (mode: AccountMode): void => {
      accountDialog.open(mode, {
        suggestedName: myName ?? suggestion,
        onDone: ({ token, account }) => {
          saveSession(token);
          applyAccount(token, account);
          toasts.show(vi.account.signedIn);
        },
      });
    };
    const signOut = (): void => {
      const token = session;
      if (token === null) return;
      forgetSession();
      driver.setSession(null);
      // Best effort: the token is already gone here; a failed call only leaves an orphan row that expires.
      void accountApi.logout(token);
      toasts.show(vi.account.signedOut);
    };
    const invite = new InviteDialog(new InviteAction({ net: driver, currentRoom: () => room }));
    const inviteFriend = (): void => {
      people.close();
      invite.open();
    };
    const people = new PeopleDialog(driver, () => room, document.body, {
      invite: inviteFriend,
      rename: renameSelf,
    });

    // Floating "Công đức +1" anchor positioned right above the local player's nameplate only.
    const meritAnchor = document.createElement("div");
    meritAnchor.style.position = "fixed";
    meritAnchor.style.left = "0";
    meritAnchor.style.top = "0";
    meritAnchor.style.width = "0";
    meritAnchor.style.height = "0";
    meritAnchor.style.pointerEvents = "none";
    meritAnchor.style.zIndex = "var(--z-hud, 10)";
    meritAnchor.hidden = true;
    document.body.append(meritAnchor);
    const activeMerits: HTMLSpanElement[] = [];
    const meritWorldPos = new Vector3();
    let meritSx = NaN;
    let meritSy = NaN;

    const spawnMeritFloat = (): void => {
      if (activeMerits.length >= MAX_MERIT_FLOATS) {
        activeMerits.shift()?.remove();
      }
      const span = document.createElement("span");
      span.className = "merit-float";
      span.textContent = vi.hud.meritFloat;
      activeMerits.push(span);
      meritAnchor.append(span);
      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        const idx = activeMerits.indexOf(span);
        if (idx !== -1) activeMerits.splice(idx, 1);
        span.remove();
        if (activeMerits.length === 0) {
          meritAnchor.hidden = true;
          meritSx = NaN;
          meritSy = NaN;
        }
      };
      span.addEventListener("animationend", cleanup, { once: true });
      setTimeout(cleanup, 1250);
    };

    const tapWoodblock = (): void => {
      if (suspended || beadsScreen.isOpen) return;
      if (actions.asleep) {
        actions.wake();
        if (selfId) labels.setAsleep(selfId, false);
      }
      hud.closeGestureMenu();
      woodblockCount += 1;
      saveWoodblockCount(woodblockCount);
      hud.setWoodblockCount(woodblockCount, true);
      progression.addMerit(1);
      progression.recordAction("woodblock", 1);
      spiritualEffects.triggerTap();
      audio.woodblock();
      self.tap();
      spawnMeritFloat();
      driver.bead();
    };

    const sendWishIfAllowed = (wish: string): void => {
      if (!wish || status !== "connected" || session === null) return;
      if (!roomAllowsChat(room)) return;
      driver.sendChat(wish);
    };

    /** Local reverent palm-clasp posture for temple offerings without broadcasting a social greeting event. */
    const localClasp = (): void => {
      if (actions.asleep) {
        actions.wake();
        if (selfId) labels.setAsleep(selfId, false);
      }
      if (!actions.bowing && !actions.beadsOpen) {
        movement.stop();
        self.setPose("hello");
      }
      audio.hello();
    };

    const dharma = new DharmaDialog({
      onShakeTick: () => {
        audio.bead();
      },
      onDrawn: (title) => {
        audio.bell();
        localClasp();
        progression.recordAction("offering", 1);
        toasts.show(vi.toast.dharmaDrawn.replace("{title}", title));
      },
      onShare: (verse) => {
        if (status === "connected" && session !== null && roomAllowsChat(room)) {
          driver.sendChat(verse);
          dharma.close();
          toasts.show(vi.toast.dharmaShared);
        } else {
          toasts.show(vi.toast.dharmaShareQuiet, "warn");
        }
      },
    });

    const wishTree = new WishTreeDialog({
      onHangWish: (wishText) => {
        scenery.hangWish();
        audio.bell();
        localClasp();
        progression.recordAction("offering", 1);
        toasts.show(vi.toast.wishHung);
        sendWishIfAllowed(wishText);
      },
      onEmptyWish: () => {
        toasts.show(vi.toast.wishEmpty, "warn");
      },
    });
    for (let i = 0; i < wishTree.savedCount; i++) {
      scenery.hangWish();
    }

    const offering = new OfferingDialog({
      onIncense: (wish) => {
        scenery.lightIncense();
        if (wish.trim()) {
          wishTree.recordWish(wish);
          scenery.hangWish();
        }
        audio.bell();
        localClasp();
        progression.recordAction("offering", 1);
        toasts.show(vi.toast.incenseOffered);
        sendWishIfAllowed(wish);
      },
      onLantern: (wish) => {
        scenery.releaseLantern();
        if (wish.trim()) {
          wishTree.recordWish(wish);
          scenery.hangWish();
        }
        audio.bell();
        localClasp();
        progression.recordAction("offering", 1);
        toasts.show(vi.toast.lanternOffered);
        sendWishIfAllowed(wish);
      },
      onBell: () => {
        audio.templeBell();
        localClasp();
        progression.recordAction("offering", 1);
        toasts.show(vi.toast.bellRung);
      },
      onWoodblock: () => {
        tapWoodblock();
      },
    });

    const applyRobeColor = (color: string): void => {
      self.setColor(color);
      settings.setColor(color);
      progressionDialog.setPlayerColor(color);
    };

    const settings = new SettingsDialog(
      audio,
      chant,
      now,
      renameSelf,
      {
        // One dialog at a time: both are see-through, stacked they read as one mess.
        signIn: () => {
          settings.close();
          openAccount("register");
        },
        signOut,
      },
      document.body,
      (color) => {
        saveSavedColor(color);
        applyRobeColor(color);
      },
      {
        openPeople: () => people.open(),
        openInvite: inviteFriend,
        openOffering: () => offering.open(),
        openRooms: () => rooms.open(),
        exitGame: () => suspend("exit"),
      },
    );

    const progressionDialog = new ProgressionDialog(progression, {
      onClaimReward: (_merit, label) => {
        audio.bell();
        toasts.show(label);
      },
      onShopAction: (res) => {
        if (res.action === "bought") {
          audio.templeBell();
          toasts.show(`Đã thỉnh và trang bị: ${res.item.name}`);
        } else if (res.action === "equipped") {
          audio.bead();
          toasts.show(`Đã trang bị: ${res.item.name}`);
        } else if (res.action === "unequipped") {
          audio.bead();
          toasts.show(`Đã gỡ: ${res.item.name}`);
        } else if (res.action === "insufficient") {
          toasts.show(`Cần thêm ${res.missing} Công đức để thỉnh ${res.item.name}`, "warn");
        }
      },
      onOpenSettings: () => settings.open(),
      onOpenOffering: () => offering.open(),
      onOpenRooms: () => rooms.open(),
      onRename: renameSelf,
    });

    let shownHudGesture: AvatarGestureKind | null = null;
    const syncHudGesture = (): void => {
      if (self.gesture !== shownHudGesture) {
        shownHudGesture = self.gesture;
        hud.setGesture(shownHudGesture);
      }
    };
    const clearStationaryGesture = (): void => {
      if (self.gesture !== null && self.gesture !== "kinhHanh") {
        self.setGesture(null);
        syncHudGesture();
      }
    };

    const triggerGesture = (kind: GestureKind): void => {
      if (suspended || beadsScreen.isOpen) return;
      if (kind === "lantern") {
        scenery.releaseLantern();
        audio.bell();
        localClasp();
        progression.recordAction("offering", 1);
        toasts.show(vi.toast.lanternOffered);
        return;
      }
      if (kind === "bell") {
        audio.templeBell();
        localClasp();
        progression.recordAction("offering", 1);
        toasts.show(vi.toast.bellRung);
        return;
      }
      if (kind === "dharma") {
        dharma.open();
        return;
      }
      if (kind === "wish") {
        wishTree.open();
        return;
      }
      if (actions.bowing) actions.interrupt();
      if (self.gesture === kind) {
        self.setGesture(null);
        syncHudGesture();
        return;
      }
      if (kind === "gardenSit" || kind === "bowGreet") {
        movement.stop();
      }
      self.setGesture(kind);
      audio.hello();
      syncHudGesture();
    };

    window.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || suspended || ownedByUi(e.target)) return;
      if (e.code === "Digit4" || e.code === "Numpad4") {
        e.preventDefault();
        tapWoodblock();
      } else if (e.code === "Digit5" || e.code === "Numpad5") {
        e.preventDefault();
        const cur = self.gesture;
        const idx = cur === null ? -1 : GESTURE_ORDER.indexOf(cur);
        const next = idx + 1 < GESTURE_ORDER.length ? (GESTURE_ORDER[idx + 1] ?? null) : null;
        if (next === null) {
          self.setGesture(null);
          syncHudGesture();
        } else {
          triggerGesture(next);
        }
      } else if (e.code === "Digit6" || e.code === "Numpad6" || e.code === "KeyJ") {
        e.preventDefault();
        progressionDialog.toggle();
      }
    });

    const hud = new Hud({
      rooms: () => rooms.open(),
      hello: () => actions.hello(),
      bow: () => actions.bow(),
      beads: () => actions.toggleBeads(),
      woodblock: () => tapWoodblock(),
      gesture: (kind) => triggerGesture(kind),
      offering: () => offering.open(),
      people: () => people.open(),
      invite: inviteFriend,
      exit: () => suspend("exit"),
      sound: () => audio.toggleMuted(),
      settings: () => settings.open(),
      chant: () => chant.toggle(),
    });
    hud.setWoodblockCount(woodblockCount);

    // L5: own scene on the same renderer, built on first open; the world stops updating while it shows.
    let beadsScene: BeadsScene | null = null;
    let sessionBeads = 0;
    const beadsScreen = new BeadsScreen({
      storage: safeLocalStorage(),
      onClose: () => actions.closeBeads(),
      onBead: () => {
        audio.bead();
        actions.bead();
        sessionBeads += 1;
        progression.recordAction("beads", 1);
        if (sessionBeads % 9 === 0) {
          progression.addMerit(1);
        }
      },
      onCount: (c, animate) => {
        e2eState.beads = c;
        beadsScene?.setTarget(centreSlot(c.total), !animate);
      },
      toggleSound: () => audio.toggleMuted(),
    });
    e2eState.beads = beadsScreen.count;
    actions.on("beads", (open) => {
      if (!open) {
        beadsScreen.close();
        return;
      }
      beadsScene ??= new BeadsScene();
      beadsScreen.open();
    });
    audio.on("change", () => {
      hud.setSound(!audio.muted);
      beadsScreen.setSound(!audio.muted);
    });
    chant.onChange((c) => {
      hud.setChant(c.on);
      if (c.error) toasts.show(vi.toast.chantError, "warn");
    });
    hud.setSound(!audio.muted);
    beadsScreen.setSound(!audio.muted);
    hud.setChant(chant.state.on);
    const initialRoomNum = roomNumber(room) ?? 1;
    const initialRoomName = roomNameOf(null, initialRoomNum);
    hud.setRoom(initialRoomNum, initialRoomName);
    settings.setRoomInfo(initialRoomNum, initialRoomName);
    progressionDialog.setRoomInfo(initialRoomNum, initialRoomName, status);
    hud.addBanner(new CeremonyBanner(now).element);
    // Shows itself on a chat room's snapshot; guests get the create-account button (P4-D9).
    const chat = new ChatPanel({
      driver,
      roomAllowsChat,
      isSignedIn: () => session !== null,
      openAccount,
      openRooms: () => rooms.open(),
    });

    // P3-D4: no saved name → nobody is joined until the visitor picks one (asked once the scene is up).
    let entered = savedName !== null;
    // Same suggestion if rest / exit interrupts the first ask and `resume` asks again.
    const suggestion = makeName(Math.random, new Set());
    if (myName !== null) {
      settings.setName(myName);
      progressionDialog.setPlayerName(myName);
    } else {
      progressionDialog.setPlayerName(suggestion);
    }
    applyRobeColor(initialRobeColor);

    const askName = (): void => {
      nameDialog.open("enter", suggestion, (name) => {
        useName(name);
        entered = true;
        join();
      });
    };

    // Exit and rest both leave the room, stop rendering and silence audio; coming back rejoins the same room.
    let suspended: "exit" | "rest" | null = null;
    const exitScreen = new ExitScreen(() => resume());
    const rest = new RestScreen({
      // D25: inactive → doze in place (still in the room); only a long doze leaves it.
      onSleep: () => {
        if (suspended || !actions.sleep()) return false;
        if (selfId) labels.setAsleep(selfId, true);
        return true;
      },
      onWake: () => {
        actions.wake();
        if (selfId) labels.setAsleep(selfId, false);
      },
      onAway: (away) => {
        if (!suspended) audio.setSuspended(away);
      },
      onRest: () => suspend("rest"),
      sleepMs: p.sleepMs ?? undefined,
      onResume: () => resume(),
      backgroundPlay: () => audio.settings.backgroundPlay,
    });

    const floorTap = (x: number, y: number): void => {
      actions.interrupt();
      clearStationaryGesture();
      movement.walkTo(pickFloor(cameraWorld, camera, x, y, window.innerWidth, window.innerHeight));
    };
    const joystick = new Joystick({
      onTap: floorTap,
    });

    const suspend = (why: "exit" | "rest"): void => {
      if (suspended) return;
      suspended = why;
      rooms.close();
      people.close();
      invite.close();
      settings.close();
      offering.close();
      dharma.close();
      wishTree.close();
      progressionDialog.close();
      nameDialog.dismiss();
      accountDialog.close();
      hud.closeGestureMenu();
      joystick.reset();
      audio.setSuspended(true);
      actions.wake();
      actions.interrupt();
      self.setGesture(null);
      syncHudGesture();
      movement.stop();
      driver.disconnect();
      loop?.setPaused(true);
      if (why === "exit") exitScreen.show();
      else rest.show();
    };
    const resume = (): void => {
      if (!suspended) return;
      suspended = null;
      exitScreen.hide();
      rest.hide();
      loop?.setPaused(false);
      audio.setSuspended(false);
      if (entered) driver.connect(room);
      else if (accountChecked) askName();
    };
    actions.on("state", (s) => {
      if (s === "seeking-seat" || s === "kneeling" || s === "rising" || s === "beads" || s === "hello") {
        if (self.gesture !== null) {
          self.setGesture(null);
          syncHudGesture();
        }
      }
      hud.setAction(s, actions.bowing);
    });
    let joined = false;
    let releaseLost: (() => void) | null = null;
    driver.on("status", (s) => {
      status = s;
      hud.setStatus(s);
      settings.setPeopleStatus(remotes.realCount, s);
      const rn = roomNumber(room) ?? 1;
      progressionDialog.setRoomInfo(rn, rooms.nameOf(room), s);
      hud.setBowLocked(s !== "connected");
      if (s !== "reconnecting") {
        releaseLost?.();
        releaseLost = null;
      }
      if (s === "connecting" && !joined) toasts.show(vi.toast.connecting);
      else if (s === "reconnecting") releaseLost ??= toasts.hold(vi.toast.reconnecting, "warn");
      else if (s === "full" || s === "limited") {
        toasts.show(s === "full" ? vi.toast.roomFull : vi.toast.tooMany, "error");
        rooms.open(room, s === "limited");
      } else if (s === "connected") joined = true;
    });

    const chip = createWalkChip(() => {
      actions.interrupt();
      movement.stop();
    });
    movement.on("walking", (walking) => chip.setVisible(walking));
    const events = new EventFilter();
    remotes.onChange(() => {
      movement.setObstacles(remotes.obstacles);
      const keep = new Set<string>();
      if (selfId) keep.add(selfId);
      const shown: string[] = [];
      const dozing: string[] = [];
      remotes.forEach((id, name, object, _kneeling, asleep) => {
        keep.add(id);
        labels.set(id, name);
        labels.setAsleep(id, asleep);
        if (asleep) dozing.push(id);
        if (object.parent && object.visible) shown.push(id);
      });
      e2eState.others = shown;
      e2eState.asleep = dozing;
      labels.retain(keep);
      e2eState.count = remotes.realCount;
      hud.setCount(remotes.realCount);
      settings.setPeopleStatus(remotes.realCount, status);
    });
    driver.on("snapshot", (s) => {
      selfId = s.selfId;
      e2eState.selfId = s.selfId;
      const me = s.visitors.find((v) => v.id === s.selfId);
      if (me && loadSavedColor() === null) {
        applyRobeColor(me.color);
      }
      const near = readNear(location.search);
      // Joined through an invite: the server put us beside the inviter, so adopt that spot instead of our own random spawn.
      if (me && me.cushion === null && near !== null) movement.teleport(me.position);
      // The inviter left (or the link is old): say so rather than leave us looking for them at the gate.
      if (near !== null && !s.visitors.some((v) => v.id === near)) toasts.show(vi.toast.inviterGone);
      stripNearFromUrl();
      if (me) {
        labels.set(me.id, me.name, true);
        labels.setTitle(me.id, progression.equippedTitleBadge);
        labels.setAsleep(me.id, actions.asleep);
        progressionDialog.setPlayerName(myName ?? me.name);
      }
      selfName = me?.name ?? null;
      e2eState.selfName = selfName;
      remotes.applySnapshot(s);
      actions.syncSelf(me?.cushion ?? null, s.reserved);
      // Every snapshot is a (re)join; `room` is already the target by now, so compare nothing and start clean.
      labels.clearBubbles();
      e2eState.room = s.room;
      room = s.room;
      const rn = roomNumber(s.room) ?? 1;
      hud.setRoom(rn, s.roomName);
      settings.setRoomInfo(rn, s.roomName);
      progressionDialog.setRoomInfo(rn, s.roomName, status);
      // The room we are really in goes to the URL (L6: shareable, no reload).
      if (roomFromSearch(location.search) !== s.room) writeRoomToUrl(s.room);
      driver.sendMove(movement.position, self.pose);
    });
    driver.on("update", (u) => {
      // A rename comes back to us too (P3-D2); RemoteAvatars skips our own record, so our label follows it here.
      const me = selfId === null ? undefined : u.visitors.find((v) => v.id === selfId);
      if (me && me.name !== selfName) {
        selfName = me.name;
        labels.set(me.id, selfName, true);
        labels.setTitle(me.id, progression.equippedTitleBadge);
        progressionDialog.setPlayerName(myName ?? selfName);
        e2eState.selfName = selfName;
      }
      remotes.applyUpdate(u);
    });
    // Live lines only (history stays in the panel); our own echo shows over us too (P4-D9).
    driver.on("chat", (line) => labels.say(line.visitorId, line.text, performance.now()));
    driver.on("account", (a) => {
      // A reply to an `auth` sent before signing out is stale.
      if (session === null) return;
      // Only fills the row when `me` could not answer (offline at start); the mock driver names every account alike.
      if (a !== null) {
        if (username === null) showAccount(a.username);
      } else {
        // Token refused (expired, signed out elsewhere); the driver keeps it until told (T4b).
        forgetSession();
        driver.setSession(null);
      }
    });
    driver.on("inviteArrived", (a) => toasts.show(vi.toast.arrivedNear.replace("{name}", a.name)));
    driver.on("corrected", (p) => movement.teleport(p));
    driver.on("event", (e) => {
      if (!events.accept(e, serverNow()) || e.visitorId === selfId) return;
      if (e.type === "hello") {
        remotes.greet(e.visitorId);
        const name = remotes.nameOf(e.visitorId);
        if (name) toasts.show(vi.toast.helloFrom.replace("{name}", name));
      } else if (e.type === "bead") {
        if (remotes.tap(e.visitorId)) audio.woodblock();
      }
    });
    movement.on("move", (p) => driver.sendMove(p, self.pose));
    // L1: no `?room=` → the emptiest room with space (room 1 when the list is unreachable).
    const join = (): void => {
      if (roomFromSearch(location.search)) driver.connect(room);
      else
        driver.listRooms().then(
          (list) => {
            room = emptiestRoom(list) ?? room;
            if (reloadIfOtherSpace(room)) return;
            const rn = roomNumber(room) ?? 1;
            const rName = list.find((r) => r.id === room)?.name ?? roomNameOf(null, rn);
            hud.setRoom(rn, rName);
            settings.setRoomInfo(rn, rName);
            progressionDialog.setRoomInfo(rn, rName, status);
            driver.connect(room);
          },
          () => driver.connect(room),
        );
    };
    if (entered) join();

    const checkSession = async (token: string): Promise<void> => {
      try {
        const r = await accountApi.me(token);
        // Signed out or in again while waiting.
        if (session !== token) return;
        if (r.ok) applyAccount(token, r.account);
        else if (r.error === "unauthorized") forgetSession();
        // Offline / server down: keep the token; the socket answers `account null` if it is bad.
        else driver.setSession(token);
      } finally {
        accountChecked = true;
        if (!entered && !suspended && firstFrameShown) askName();
      }
    };
    if (session !== null) void checkSession(session);

    document.body.prepend(renderer.domElement);
    const stats = new FrameStats();
    const quality = new Quality(renderer, stats, p.e2e ? 1 : null);
    const activeRenderer = renderer;
    const perf = (): PerfInfo => {
      const s = stats.summary();
      return { calls: activeRenderer.info.render.calls, triangles: activeRenderer.info.render.triangles, fps: s.fps, p95: s.p95 };
    };

    const input = new Input(renderer.domElement, {
      tap: floorTap,
      rotate: rig.rotate,
      zoom: rig.zoom,
    });
    const axes: MoveAxes = { forward: 0, right: 0 };
    const joyAxes: MoveAxes = { forward: 0, right: 0 };
    const selfState: NonNullable<E2EState["self"]> = { position: { ...movement.position }, pose: self.pose, cushion: null, asleep: false };
    e2eState.self = selfState;

    // Position the player, camera, lights, and region visibility for the spawn view and pre-compile all GPU shaders/textures
    // while the boot overlay is still covering the canvas, so frame 1 has zero white flash or missing items.
    const initialY = space.groundY(spawn.x, spawn.z);
    self.object.position.set(spawn.x, initialY, spawn.z);
    self.object.rotation.y = spawn.yaw;
    contacts.place(0, spawn.x, initialY, spawn.z);
    if (!fixedCamera) rig.update(0, spawn.x, initialY, spawn.z, movement.heading);
    env.setFocus(spawn.x, initialY, spawn.z);
    env.update(0, camera);
    scenery.update(0, 0, env.daylight, camera);
    activeRenderer.compile(scene, camera);
    activeRenderer.render(scene, camera);

    const beadsShown = (): BeadsScene | null => (beadsScreen.isOpen ? beadsScene : null);
    loop = new Loop(
      renderer,
      () => {
        const b = beadsShown();
        if (b) activeRenderer.render(b.scene, b.camera);
        else activeRenderer.render(scene, camera);
      },
      stats,
    );
    loop.add((dt) => beadsShown()?.update(dt));
    // World-only updaters pause behind the bead screen; our own state (above) keeps running.
    const world =
      (fn: (dt: number, t: number) => void) =>
      (dt: number, t: number): void => {
        if (!beadsShown()) fn(dt, t);
      };
    loop.add((dt) => {
      input.axes(axes);
      joystick.axes(joyAxes);
      if (joyAxes.forward !== 0 || joyAxes.right !== 0) {
        axes.forward = joyAxes.forward;
        axes.right = joyAxes.right;
      }
      if (axes.forward !== 0 || axes.right !== 0) {
        actions.interrupt();
        clearStationaryGesture();
      }
      // Keys are camera-relative: forward = where the camera looks, right = screen right.
      const sy = Math.sin(rig.yaw);
      const cy = Math.cos(rig.yaw);
      movement.setDirection(sy * axes.forward - cy * axes.right, cy * axes.forward + sy * axes.right);
      movement.update(dt, performance.now());
      actions.update(dt);

      const pos = movement.position;
      const y = actions.seated ? CUSHION_TOP : space.groundY(pos.x, pos.z);
      self.object.position.set(pos.x, y, pos.z);
      self.object.rotation.y = pos.yaw;
      self.setMoving(movement.speed);
      self.update(dt, now());
      spiritualEffects.update(dt);
      syncHudGesture();
      contacts.place(0, pos.x, y, pos.z);
      if (!fixedCamera) rig.update(dt, pos.x, y, pos.z, movement.heading);
      env.setFocus(pos.x, y, pos.z);

      selfState.position.x = pos.x;
      selfState.position.z = pos.z;
      selfState.position.yaw = pos.yaw;
      selfState.pose = self.pose;
      selfState.cushion = actions.cushion;
      selfState.asleep = actions.asleep;
    });
    const placeLabel = (id: string, _name: string, obj: Object3D, kneeling: boolean): void => {
      labels.place(id, obj.position.x, obj.position.y + labelHeight(kneeling), obj.position.z);
    };
    loop.add(
      world((dt) => {
        remotes.update(dt, serverNow());
        labels.begin(camera);
        const o = self.object.position;
        const headY = o.y + labelHeight(actions.seated || actions.asleep || self.pose === "beads" || self.sitting);
        if (selfId) {
          labels.place(selfId, o.x, headY, o.z);
        }
        if (activeMerits.length > 0) {
          meritWorldPos.set(o.x, headY, o.z).project(camera);
          if (meritWorldPos.z > 1) {
            if (!meritAnchor.hidden) meritAnchor.hidden = true;
          } else {
            const sx = Math.round((meritWorldPos.x * 0.5 + 0.5) * window.innerWidth * 2) / 2;
            const sy = Math.round((-meritWorldPos.y * 0.5 + 0.5) * window.innerHeight * 2) / 2;
            meritAnchor.hidden = false;
            if (sx !== meritSx || sy !== meritSy) {
              meritSx = sx;
              meritSy = sy;
              meritAnchor.style.transform = `translate3d(${sx}px, ${sy - 30}px, 0)`;
            }
          }
        }
        remotes.forEach(placeLabel);
        labels.end();
      }),
    );
    loop.add(world((dt) => env.update(dt, camera)));
    loop.add(world((dt, t) => scenery.update(dt, t, env.daylight, camera)));
    loop.add(quality.update);
    if (p.debug) loop.add(createDebugOverlay(perf).update);
    if (p.e2e) installE2EHooks(perf);

    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      quality.apply();
    });

    loop.onFirstFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          hideBoot();
          e2eState.ready = true;
          firstFrameShown = true;
          // Rest / exit may already have taken over (hidden tab); `resume` asks then. A saved session answers first.
          if (!entered && !suspended && accountChecked) askName();
        });
      });
    });
    loop.start();
  } catch (err) {
    renderer.domElement.remove();
    renderer.dispose();
    assets.dispose();
    throw err;
  }
}
