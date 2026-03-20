import { S } from '../core/state';

export interface ResolvedNotificationConfig {
  enabled: boolean;
  volume: number;
  soundEnabled: boolean;
  osNotification: boolean;
  position: string;
  duration: number;
  customSound: string | null;
}

const NOTIF_TYPE_MAP: Record<string, string> = {
  done: 'aiDone',
  question: 'aiQuestion',
};

/** AI matched.type('done','question') → settings key('aiDone','aiQuestion') 변환 */
export function mapNotifType(internalType: string): string {
  return NOTIF_TYPE_MAP[internalType] || internalType;
}

/** 글로벌 + 유형별 오버라이드 머지 */
export function getNotificationConfig(type: string): ResolvedNotificationConfig {
  const notif = S.settings?.notifications;
  if (!notif) {
    return {
      enabled: true,
      volume: 80,
      soundEnabled: true,
      osNotification: true,
      position: 'top-right',
      duration: 5000,
      customSound: null,
    };
  }
  const g = notif.global;
  const t = notif.types?.[type];
  if (!t) {
    return { enabled: true, ...g };
  }
  return {
    enabled: t.enabled ?? true,
    volume: t.volume ?? g.volume,
    soundEnabled: t.soundEnabled ?? g.soundEnabled,
    osNotification: t.osNotification ?? g.osNotification,
    position: t.position ?? g.position,
    duration: t.duration ?? g.duration,
    customSound: t.customSound ?? g.customSound,
  };
}

const defaultAlertSound = new Audio('/alert.m4a');

/** 설정에 따라 알림 사운드 재생. cfgOverride 전달 시 해당 설정 사용. */
export function playNotificationSound(type: string, cfgOverride?: ResolvedNotificationConfig): void {
  const cfg = cfgOverride || getNotificationConfig(type);
  if (!cfg.soundEnabled) return;

  let audio: HTMLAudioElement;
  if (cfg.customSound) {
    audio = new Audio(cfg.customSound);
  } else {
    audio = defaultAlertSound;
    audio.currentTime = 0;
  }
  audio.volume = cfg.volume / 100;
  audio.play().catch(() => {});
}

/** 위치별 toast-zone 컨테이너 얻기/생성 */
export function getOrCreateToastZone(position: string): HTMLElement {
  const id = `toast-zone-${position}`;
  let zone = document.getElementById(id);
  if (!zone) {
    zone = document.createElement('div');
    zone.id = id;
    zone.className = `toast-zone toast-zone-${position}`;
    document.body.appendChild(zone);
  }
  return zone;
}
