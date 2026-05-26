import { useState, useRef, useCallback } from 'react'

interface UseSpeechInputOptions {
  onTranscript: (text: string) => void
  lang?: string
}

export function useSpeechInput({ onTranscript, lang = 'zh-CN' }: UseSpeechInputOptions) {
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  const supported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const start = useCallback(() => {
    if (!supported) {
      setError('浏览器不支持语音识别')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    const recognition = new SR()
    recognition.lang = lang
    recognition.continuous = false
    recognition.interimResults = false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      const text = e.results[0][0].transcript
      onTranscript(text)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (e: any) => {
      setError(`语音识别错误: ${e.error}`)
      setIsListening(false)
    }
    recognition.onend = () => setIsListening(false)

    recognition.start()
    recognitionRef.current = recognition
    setIsListening(true)
    setError(null)
  }, [supported, lang, onTranscript])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  return { isListening, error, supported, start, stop }
}
