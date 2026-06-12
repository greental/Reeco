import type { ServerEventDto } from '../types/api.js';

export function connectServerEvents(onEvent: (event: ServerEventDto) => void, onStatus: (status: string, connected: boolean) => void) {
  if (!('EventSource' in window)) {
    onStatus('Live events unavailable in this browser', false);
    return () => undefined;
  }
  const source = new EventSource('/api/events');
  source.onopen = () => onStatus('Live events connected', true);
  source.onerror = () => onStatus('Live events reconnecting…', false);
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as ServerEventDto);
  return () => source.close();
}