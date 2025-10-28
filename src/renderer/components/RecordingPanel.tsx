import React, { useState } from 'react'
import ScreenCapture from './ScreenCapture'
import WebcamCapture from './WebcamCapture'
import PiPRecorder from './PiPRecorder'

type RecordingMode = 'screen' | 'webcam' | 'pip'

type Props = {
  onRecordingComplete?: (filePath: string) => void
  videoRef?: React.RefObject<HTMLVideoElement>
  setIsRecording?: (recording: boolean) => void
}

export default function RecordingPanel({ onRecordingComplete, videoRef, setIsRecording }: Props) {
  const [mode, setMode] = useState<RecordingMode>('screen')

  return (
    <div style={{ borderTop: '2px solid #333', background: '#f9f9f9' }}>
      {/* Tab Navigation */}
      <div style={{ 
        display: 'flex', 
        gap: 0, 
        borderBottom: '1px solid #ddd',
        background: '#fff'
      }}>
        <button
          onClick={() => setMode('screen')}
          style={{
            flex: 1,
            padding: '12px 16px',
            border: 'none',
            background: mode === 'screen' ? '#2563eb' : '#fff',
            color: mode === 'screen' ? '#fff' : '#333',
            fontWeight: mode === 'screen' ? 'bold' : 'normal',
            cursor: 'pointer',
            fontSize: 14,
            borderRight: '1px solid #ddd',
            transition: 'all 0.2s'
          }}
        >
          🖥️ Screen Only
        </button>
        <button
          onClick={() => setMode('webcam')}
          style={{
            flex: 1,
            padding: '12px 16px',
            border: 'none',
            background: mode === 'webcam' ? '#2563eb' : '#fff',
            color: mode === 'webcam' ? '#fff' : '#333',
            fontWeight: mode === 'webcam' ? 'bold' : 'normal',
            cursor: 'pointer',
            fontSize: 14,
            borderRight: '1px solid #ddd',
            transition: 'all 0.2s'
          }}
        >
          📹 Webcam Only
        </button>
        <button
          onClick={() => setMode('pip')}
          style={{
            flex: 1,
            padding: '12px 16px',
            border: 'none',
            background: mode === 'pip' ? '#2563eb' : '#fff',
            color: mode === 'pip' ? '#fff' : '#333',
            fontWeight: mode === 'pip' ? 'bold' : 'normal',
            cursor: 'pointer',
            fontSize: 14,
            transition: 'all 0.2s'
          }}
        >
          🎬 Screen + Webcam (PiP)
        </button>
      </div>

      {/* Tab Content */}
      <div>
        {mode === 'screen' && (
          <ScreenCapture 
            onRecordingComplete={onRecordingComplete}
            videoRef={videoRef}
            setIsRecording={setIsRecording}
          />
        )}
        {mode === 'webcam' && (
          <WebcamCapture 
            onRecordingComplete={onRecordingComplete}
            videoRef={videoRef}
            setIsRecording={setIsRecording}
          />
        )}
        {mode === 'pip' && (
          <PiPRecorder 
            onRecordingComplete={onRecordingComplete}
            videoRef={videoRef}
            setIsRecording={setIsRecording}
          />
        )}
      </div>
    </div>
  )
}

