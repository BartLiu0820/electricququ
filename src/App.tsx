import { MatchPage } from './components/MatchPage';
import { SetupPage } from './components/SetupPage';
import { useMatch } from './store/match';

export default function App() {
  const inMatch = useMatch((s) => s.config !== null);
  return inMatch ? <MatchPage /> : <SetupPage />;
}
