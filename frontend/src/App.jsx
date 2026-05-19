import MessageSummarizer from "./MessageSummarizer.jsx";
import AuthGate from "./AuthGate.jsx";

export default function App() {
  return (
    <AuthGate>
      <MessageSummarizer />
    </AuthGate>
  );
}
