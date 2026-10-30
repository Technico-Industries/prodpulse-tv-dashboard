import AssemblyDashboard from './pages/AssemblyDashboard.jsx';

// Single screen for now. When more departments are added, pick the page here
// (e.g. from a ?dept= query param) so each TV can be pointed at its own view.
export default function App() {
  return <AssemblyDashboard />;
}
