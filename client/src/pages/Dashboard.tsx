import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Server, Terminal as TerminalIcon, Monitor, LogOut, ShieldCheck, User as UserIcon, Settings, Sun, Moon, FolderOpen, X, Globe } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useLang, AVAILABLE_LANGS } from '../context/LangContext';

interface Machine {
  id: string;
  name: string;
  ip: string;
  port: number;
  protocol: string;
  description?: string;
  machineGroupId?: string;
  machineGroup?: { id: string; name: string };
}

interface MachineGroup {
  id: string;
  name: string;
}

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { lang, setLang, t } = useLang();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [allMachines, setAllMachines] = useState<Machine[]>([]);
  const [machineGroups, setMachineGroups] = useState<MachineGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [machinesRes, groupsRes] = await Promise.all([
          api.get('/machines'),
          api.get('/machine-groups')
        ]);
        setAllMachines(machinesRes.data as any);
        setMachines(machinesRes.data as any);
        setMachineGroups(groupsRes.data as any);
      } catch (error) {
        console.error('Failed to fetch data', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedGroups.length === 0) {
      setMachines(allMachines);
    } else {
      setMachines(
        allMachines.filter(m =>
          selectedGroups.includes(m.machineGroupId || 'ungrouped') ||
          (m.machineGroupId && selectedGroups.includes(m.machineGroupId))
        )
      );
    }
  }, [selectedGroups, allMachines]);

  const toggleGroupFilter = (groupId: string) => {
    setSelectedGroups(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  const cycleLang = () => {
    const idx = AVAILABLE_LANGS.findIndex(l => l.code === lang);
    const next = AVAILABLE_LANGS[(idx + 1) % AVAILABLE_LANGS.length];
    setLang(next.code);
  };

  return (
    <div className="min-h-screen bg-background-app text-text-main font-sans transition-colors duration-300">
      <header className="bg-background-surface border-b border-border-light sticky top-0 z-50 shadow-sm transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <span className="text-xl font-bold tracking-tight text-text-main">{t('nav.brand')}</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={cycleLang}
              className="p-2 text-text-secondary hover:text-primary transition-colors"
              title={lang.toUpperCase()}
            >
              <Globe size={18} />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 text-text-secondary hover:text-primary transition-colors mr-2"
              title={theme === 'light' ? t('common.darkMode') : t('common.lightMode')}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            {user?.role === 'ADMIN' && (
              <Link
                to="/administration"
                className="flex items-center gap-2 text-text-secondary hover:text-primary transition-colors text-sm font-medium mr-4"
              >
                <Settings className="w-4 h-4" />
                {t('nav.administration')}
              </Link>
            )}

            <Link to="/profile" className="flex items-center gap-2 group">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-text-main group-hover:text-primary transition-colors">{user?.username || user?.email}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                <UserIcon size={16} />
              </div>
            </Link>

            <button
              onClick={logout}
              className="p-2 text-text-secondary hover:text-danger rounded-md transition-colors"
              title={t('nav.logout')}
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-10">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-text-main mb-1">{t('dashboard.title')}</h1>
          <p className="text-text-secondary text-sm">{t('dashboard.subtitle')}</p>
        </div>

        {machineGroups.length > 0 && (
          <div className="mb-8 p-6 bg-background-surface border border-border-light rounded-lg">
            <div className="flex items-center gap-3 mb-4">
              <FolderOpen size={20} className="text-primary" />
              <h2 className="font-bold text-text-main">{t('dashboard.filterByGroup')}</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {machineGroups.map(group => (
                <button
                  key={group.id}
                  onClick={() => toggleGroupFilter(group.id)}
                  className={`px-4 py-2 rounded-lg border transition-all text-sm font-medium flex items-center gap-2 justify-center ${
                    selectedGroups.includes(group.id)
                      ? 'bg-primary/10 border-primary/50 text-primary'
                      : 'bg-background-app border-border-light text-text-secondary hover:border-primary/30 hover:text-text-main'
                  }`}
                >
                  <FolderOpen size={14} />
                  {group.name}
                </button>
              ))}
            </div>
            {selectedGroups.length > 0 && (
              <button
                onClick={() => setSelectedGroups([])}
                className="mt-4 flex items-center gap-2 text-[10px] font-bold text-primary uppercase hover:opacity-75 transition-opacity"
              >
                <X size={14} />
                {t('dashboard.resetFilters')}
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-background-surface animate-pulse rounded-lg border border-border-light shadow-sm" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {machines.map((machine) => (
              <div
                key={machine.id}
                className="group bg-background-surface p-6 rounded-lg border border-border-light hover:border-primary/50 transition-all duration-200 shadow-sm flex flex-col"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 bg-primary/5 rounded-lg text-primary">
                    <Server className="w-6 h-6" />
                  </div>
                  <span className="pill-badge bg-primary/10 text-primary text-[10px] uppercase font-bold tracking-wider">
                    {machine.protocol}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-text-main mb-1">{machine.name}</h3>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-success" />
                  <span className="text-xs font-mono text-text-secondary">{machine.ip}:{machine.port}</span>
                </div>

                {machine.machineGroup && (
                  <div className="flex items-center gap-2 mb-4 px-2 py-1 bg-primary/5 rounded w-fit text-[10px]">
                    <FolderOpen size={12} className="text-primary" />
                    <span className="text-primary font-bold">{machine.machineGroup.name}</span>
                  </div>
                )}

                {machine.description && (
                  <p className="text-sm text-text-secondary mb-6 line-clamp-2 flex-grow">{machine.description}</p>
                )}

                <Link
                  to={machine.protocol === 'RDP' ? `/rdp/${machine.id}` : `/session/${machine.id}`}
                  className="btn-primary flex items-center justify-center gap-2 w-full text-sm"
                >
                  {machine.protocol === 'RDP' ? (
                    <Monitor className="w-4 h-4" />
                  ) : (
                    <TerminalIcon className="w-4 h-4" />
                  )}
                  {machine.protocol === 'RDP'
                    ? t('rdp.title')
                    : t('terminal.title')}
                </Link>
              </div>
            ))}

            {machines.length === 0 && (
              <div className="col-span-full py-20 text-center bg-background-surface border border-dashed border-border-light rounded-lg">
                <Server className="w-12 h-12 text-neutral mx-auto mb-4 opacity-30" />
                <p className="text-text-secondary font-medium">{t('dashboard.noMachines')}</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
