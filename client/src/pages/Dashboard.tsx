import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Server, Terminal as TerminalIcon, LogOut, ShieldCheck, User as UserIcon, Settings, Sun, Moon, FolderOpen, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

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

  // Filter machines when selected groups change
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

  return (
    <div className="min-h-screen bg-background-app text-text-main font-sans transition-colors duration-300">
      {/* Header */}
      <header className="bg-background-surface border-b border-border-light sticky top-0 z-50 shadow-sm transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <span className="text-xl font-bold tracking-tight text-text-main">Open-Bastion</span>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className="p-2 text-text-secondary hover:text-primary transition-colors mr-2"
              title={theme === 'light' ? 'Mode sombre' : 'Mode clair'}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            {user?.role === 'ADMIN' && (
              <Link
                to="/administration"
                className="flex items-center gap-2 text-text-secondary hover:text-primary transition-colors text-sm font-medium mr-4"
              >
                <Settings className="w-4 h-4" />
                Administration
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
              title="Déconnexion"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-10">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-text-main mb-1">Machines accessibles</h1>
          <p className="text-text-secondary text-sm">Sélectionnez une ressource pour ouvrir une session sécurisée.</p>
        </div>

        {/* Machine Groups Filter */}
        {machineGroups.length > 0 && (
          <div className="mb-8 p-6 bg-background-surface border border-border-light rounded-lg">
            <div className="flex items-center gap-3 mb-4">
              <FolderOpen size={20} className="text-primary" />
              <h2 className="font-bold text-text-main">Filtrer par groupe</h2>
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
                Réinitialiser les filtres
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
                  to={`/session/${machine.id}`}
                  className="btn-primary flex items-center justify-center gap-2 w-full text-sm"
                >
                  <TerminalIcon className="w-4 h-4" />
                  Ouvrir la session
                </Link>
              </div>
            ))}

            {machines.length === 0 && (
              <div className="col-span-full py-20 text-center bg-background-surface border border-dashed border-border-light rounded-lg">
                <Server className="w-12 h-12 text-neutral mx-auto mb-4 opacity-30" />
                <p className="text-text-secondary font-medium">Aucune machine disponible pour votre compte.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
