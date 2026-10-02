// Đọc giọng HLV. App cài: dùng giọng đọc gốc của máy (plugin TextToSpeech) — WebView Android không có
// speechSynthesis, và iOS cần giọng gốc để đọc khi khóa màn hình (kèm chế độ nền "audio" trong Info.plist).
// Trình duyệt, hoặc bản app cũ chưa có plugin: dùng speechSynthesis như trước.
import { Capacitor } from '@capacitor/core'
import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech'
import { isNativeApp } from './native'

function speakWeb(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'vi-VN'
  window.speechSynthesis.speak(u)
}

export function speak(text: string) {
  if (isNativeApp() && Capacitor.isPluginAvailable('TextToSpeech')) {
    TextToSpeech.speak({ text, lang: 'vi-VN', rate: 1.0, queueStrategy: QueueStrategy.Add }).catch(() => speakWeb(text))
    return
  }
  speakWeb(text)
}
