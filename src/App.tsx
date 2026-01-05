import React, { useEffect } from 'react';
import Dashboard from './components/Dashboard/Dashboard';
import { initializePredictionService, cleanupPredictionService } from './services/predictionService';

function App() {
  useEffect(() => {
    // Initialize the global prediction service when the app starts
    initializePredictionService();

    // Cleanup when the app unmounts
    return () => {
      cleanupPredictionService();
    };
  }, []);

  return (
    <div className="min-h-screen bg-black">
      <main>
        <Dashboard />
      </main>
    </div>
  );
}

export default App;