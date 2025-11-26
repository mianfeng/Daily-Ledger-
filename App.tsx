import React, { useState } from 'react';
import { CopperShop } from './components/CopperShop';
import { DailyLedger } from './components/DailyLedger';
import { ViewType } from './types';
import { Briefcase, Calendar } from 'lucide-react';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>(ViewType.DAILY);
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] text-stone-800">
      {/* Sidebar - Desktop */}
      <nav 
        className={`fixed md:relative z-30 h-full bg-[#2c3e50] text-stone-300 transition-all duration-300 flex flex-col pt-8
          ${isSidebarOpen ? 'w-48' : 'w-[80px] hidden md:flex'}
        `}
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
      >
        <div 
          onClick={() => setCurrentView(ViewType.COPPER)}
          className={`
            cursor-pointer p-4 flex flex-col items-center gap-2 transition-colors relative
            ${currentView === ViewType.COPPER ? 'bg-[#34495e] text-white' : 'hover:bg-[#34495e] hover:text-white'}
          `}
        >
          {currentView === ViewType.COPPER && <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-600"></div>}
          <Briefcase size={24} />
          <span className={`text-xs whitespace-nowrap overflow-hidden transition-opacity duration-200 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 md:opacity-100'}`}>
            铜钱生意
          </span>
        </div>

        <div 
          onClick={() => setCurrentView(ViewType.DAILY)}
          className={`
            cursor-pointer p-4 flex flex-col items-center gap-2 transition-colors relative
            ${currentView === ViewType.DAILY ? 'bg-[#34495e] text-white' : 'hover:bg-[#34495e] hover:text-white'}
          `}
        >
          {currentView === ViewType.DAILY && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>}
          <Calendar size={24} />
          <span className={`text-xs whitespace-nowrap overflow-hidden transition-opacity duration-200 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 md:opacity-100'}`}>
            日常账本
          </span>
        </div>
      </nav>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#2c3e50] text-stone-300 flex justify-around z-40 pb-safe">
         <div 
          onClick={() => setCurrentView(ViewType.COPPER)}
          className={`flex-1 p-3 text-center ${currentView === ViewType.COPPER ? 'text-white bg-[#34495e]' : ''}`}
        >
          <div className="flex flex-col items-center">
            <Briefcase size={20} />
            <span className="text-xs mt-1">铜钱生意</span>
          </div>
        </div>
        <div 
          onClick={() => setCurrentView(ViewType.DAILY)}
          className={`flex-1 p-3 text-center ${currentView === ViewType.DAILY ? 'text-white bg-[#34495e]' : ''}`}
        >
          <div className="flex flex-col items-center">
             <Calendar size={20} />
             <span className="text-xs mt-1">日常账本</span>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 max-w-4xl mx-auto w-full pb-20 md:pb-8 overflow-y-auto h-screen scrollbar-hide">
        {currentView === ViewType.COPPER ? <CopperShop /> : <DailyLedger />}
      </main>
    </div>
  );
};

export default App;