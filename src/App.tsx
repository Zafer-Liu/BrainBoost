import { useAppStore } from './store/appStore'
import { HomeView } from './components/layout/HomeView'
import { SessionView } from './components/layout/SessionView'
import { SettingsView } from './components/layout/SettingsView'
import './styles/index.css'

export default function App() {
  const store = useAppStore()

  return (
    <div className="app">
      {store.view === 'home' && <HomeView store={store} />}
      {store.view === 'session' && <SessionView store={store} />}
      {store.view === 'settings' && <SettingsView store={store} />}
    </div>
  )
}
