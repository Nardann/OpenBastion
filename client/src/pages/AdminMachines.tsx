import React, { useEffect, useState } from 'react';
import { 
  Plus, 
  Trash2, 
  Server, 
  ShieldCheck, 
  X, 
  User as UserIcon, 
  Users2, 
  Edit2, 
  ShieldAlert, 
  ToggleLeft, 
  ToggleRight,
  Search,
  FolderPlus,
  FolderOpen,
  Fingerprint,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import api from '../services/api';

const AdminMachines = () => {
  const [machines, setMachines] = useState<any[]>([]);
  const [machineGroups, setMachineGroups] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'machines' | 'groups'>('machines');
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    ip: '',
    port: 22,
    protocol: 'SSH',
    description: '',
    sshFingerprint: '',
    username: '',
    password: '',
    privateKey: '',
    allowTunneling: false,
    allowRebound: false,
    allowCopyPaste: false,
    machineGroupId: ''
  });

  const [groupFormData, setGroupFormData] = useState({
    name: '',
    description: ''
  });

  // Permissions state
  const [isPermModalOpen, setIsPermModalOpen] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<any>(null);
  const [selectedMachineGroup, setSelectedMachineGroup] = useState<any>(null);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [permFormData, setPermFormData] = useState({
    targetType: 'user' as 'user' | 'group',
    level: 'OPERATOR' as 'OWNER' | 'OPERATOR' | 'VIEWER'
  });
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedMachineToAdd, setSelectedMachineToAdd] = useState('');

  const fetchMachines = async () => {
    try {
      const res = await api.get('/machines');
      setMachines(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchGroups = async () => {
    try {
      const res = await api.get('/machine-groups');
      setMachineGroups(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      await Promise.all([fetchMachines(), fetchGroups()]);
    } catch (error) { console.error('Fetch error:', error); }
    finally { setLoading(false); }
  };

  const fetchPermissions = async (machineId?: string, groupId?: string) => {
    try {
      const endpoint = machineId 
        ? `/permissions/machine/${machineId}` 
        : `/permissions/machine-group/${groupId}`;
      const res = await api.get(endpoint);
      setPermissions(res.data as any);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { 
    fetchData();
  }, [activeTab]);

  // Handle Autocomplete Search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const endpoint = permFormData.targetType === 'user' ? '/users' : '/groups';
        const res = await api.get(endpoint);
        const all = res.data as any[];
        
        const filtered = all.filter(item => {
          const label = permFormData.targetType === 'user' 
            ? `${item.username} ${item.email}` 
            : item.name;
          return label.toLowerCase().includes(searchQuery.toLowerCase());
        }).slice(0, 5); // Limit to 5 suggestions

        setSuggestions(filtered.map(item => ({
          id: item.id,
          label: permFormData.targetType === 'user' ? (item.username || item.email) : item.name,
          subLabel: permFormData.targetType === 'user' ? item.email : item.description
        })));
      } catch (err) { console.error(err); }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, permFormData.targetType]);

  const probeSshFingerprint = async () => {
    if (!formData.ip) {
      alert("Veuillez saisir l'adresse IP avant de vérifier l'empreinte.");
      return;
    }
    setProbing(true);
    try {
      const res = await api.post('/machines/probe-fingerprint', {
        ip: formData.ip,
        port: Number(formData.port)
      });
      setFormData({ ...formData, sshFingerprint: res.data.fingerprint });
    } catch (err: any) {
      alert("Impossible de récupérer l'empreinte. Vérifiez l'adresse IP et que le port SSH est ouvert.");
    } finally {
      setProbing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Whitelist only fields expected by the backend DTO
      const submitData: any = {
        name: formData.name,
        ip: formData.ip,
        port: Number(formData.port),
        protocol: formData.protocol,
        description: formData.description,
        sshFingerprint: formData.sshFingerprint,
        username: formData.username,
        allowTunneling: formData.allowTunneling,
        allowRebound: formData.allowRebound,
        allowCopyPaste: formData.allowCopyPaste,
      };
      
      if (formData.machineGroupId) {
        submitData.machineGroupId = formData.machineGroupId;
      }

      if (formData.password) submitData.password = formData.password;
      if (formData.privateKey) submitData.privateKey = formData.privateKey;

      if (editingId) {
        await api.patch(`/machines/${editingId}`, submitData);
      } else {
        await api.post('/machines', submitData);
      }
      setIsModalOpen(false);
      setEditingId(null);
      setFormData({ 
        name: '', ip: '', port: 22, protocol: 'SSH', description: '', sshFingerprint: '',
        username: '', password: '', privateKey: '',
        allowTunneling: true, allowRebound: true, allowCopyPaste: true,
        machineGroupId: ''
      });
      fetchData();
    } catch (err: any) { 
      alert(err.message || 'Erreur lors de l\'enregistrement'); 
    }
  };

  const handleGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.patch(`/machine-groups/${editingId}`, groupFormData);
      } else {
        await api.post('/machine-groups', groupFormData);
      }
      setIsGroupModalOpen(false);
      setEditingId(null);
      setGroupFormData({ name: '', description: '' });
      fetchGroups();
    } catch (error) {
      alert('Erreur lors de l\'enregistrement du groupe');
    }
  };

  const deleteMachine = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette machine ?')) return;
    try {
      await api.delete(`/machines/${id}`);
      fetchMachines();
    } catch (err) { alert('Erreur lors de la suppression'); }
  };

  const deleteGroup = async (id: string) => {
    if (!confirm('Supprimer ce groupe ? Les machines resteront mais seront sans groupe.')) return;
    try {
      await api.delete(`/machine-groups/${id}`);
      fetchGroups();
    } catch (error) {
      alert('Erreur lors de la suppression');
    }
  };

  const openEditMachine = (machine: any) => {
    setEditingId(machine.id);
    setFormData({
      name: machine.name,
      ip: machine.ip,
      port: machine.port,
      protocol: machine.protocol,
      description: machine.description || '',
      sshFingerprint: machine.sshFingerprint || '',
      username: machine.username || '',
      password: '',
      privateKey: '',
      allowTunneling: machine.allowTunneling,
      allowRebound: machine.allowRebound,
      allowCopyPaste: machine.allowCopyPaste,
      machineGroupId: machine.machineGroupId || ''
    });
    setIsModalOpen(true);
  };

  const openEditGroup = (group: any) => {
    setEditingId(group.id);
    setGroupFormData({
      name: group.name,
      description: group.description || ''
    });
    setIsGroupModalOpen(true);
  };

  const openPermissions = (machine: any) => {
    setSelectedMachine(machine);
    setSelectedMachineGroup(null);
    fetchPermissions(machine.id);
    setIsPermModalOpen(true);
  };

  const openGroupPermissions = (group: any) => {
    setSelectedMachineGroup(group);
    setSelectedMachine(null);
    fetchPermissions(undefined, group.id);
    setIsPermModalOpen(true);
  };

  const handlePermSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTarget) return;

    try {
      const data: any = {
        level: permFormData.level,
      };

      if (permFormData.targetType === 'user') data.userId = selectedTarget.id;
      else data.groupId = selectedTarget.id;

      if (selectedMachine) data.machineId = selectedMachine.id;
      else data.machineGroupId = selectedMachineGroup.id;

      await api.post('/permissions', data);
      setSelectedTarget(null);
      setSearchQuery('');
      fetchPermissions(selectedMachine?.id, selectedMachineGroup?.id);
    } catch (err: any) { alert(err.message || 'Erreur lors de l\'attribution'); }
  };

  const deletePermission = async (id: string) => {
    try {
      await api.delete(`/permissions/${id}`);
      fetchPermissions(selectedMachine?.id, selectedMachineGroup?.id);
    } catch (err) { alert('Erreur lors de la suppression'); }
  };

  const handleAddMachineToGroup = async () => {
    if (!editingId || !selectedMachineToAdd) return;
    try {
      await api.patch(`/machines/${selectedMachineToAdd}/assign-group`, { machineGroupId: editingId });
      setSelectedMachineToAdd('');
      fetchGroups();
      fetchMachines();
    } catch (error) {
      alert('Erreur lors de l\'ajout');
    }
  };

  const handleRemoveMachineFromGroup = async (machineId: string) => {
    try {
      await api.patch(`/machines/${machineId}/assign-group`, { machineGroupId: null });
      fetchGroups();
      fetchMachines();
    } catch (error) {
      alert('Erreur lors du retrait');
    }
  };

  const currentEditingGroup = machineGroups.find(g => g.id === editingId);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-text-main">Gestion des Machines</h1>
          <p className="text-text-secondary mt-1 text-sm">Gérez vos serveurs cibles et configurez les accès sécurisés.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-background-surface p-1 rounded-lg border border-border-light w-fit">
        <button
          onClick={() => setActiveTab('machines')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'machines' ? 'bg-background-app text-primary shadow-sm' : 'text-text-secondary hover:text-text-main'}`}
        >
          <div className="flex items-center gap-2">
            <Server size={16} />
            Machines
          </div>
        </button>
        <button
          onClick={() => setActiveTab('groups')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'groups' ? 'bg-background-app text-primary shadow-sm' : 'text-text-secondary hover:text-text-main'}`}
        >
          <div className="flex items-center gap-2">
            <FolderOpen size={16} />
            Groupes
          </div>
        </button>
      </div>

      {/* MACHINES TAB */}
      {activeTab === 'machines' && (
        <>
          <div className="flex justify-end">
            <button onClick={() => { setEditingId(null); setFormData({ name: '', ip: '', port: 22, protocol: 'SSH', description: '', sshFingerprint: '', username: '', password: '', privateKey: '', allowTunneling: false, allowRebound: false, allowCopyPaste: false, machineGroupId: '' }); setIsModalOpen(true); }} className="btn-primary flex items-center gap-2 text-sm shadow-sm">
              <Plus size={18} /> Ajouter une machine
            </button>
          </div>

          <div className="card-subtle overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="table-header border-b border-border-light">
                  <tr>
                    <th className="px-6 py-4">Nom / IP</th>
                    <th className="px-6 py-4">Groupe</th>
                    <th className="px-6 py-4 text-center">Sécurité & Protocoles</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {machines.map((machine) => (
                    <tr key={machine.id} className="group hover:bg-background-app transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary/5 rounded-lg text-primary">
                            <Server size={18} />
                          </div>
                          <div>
                            <p className="font-bold text-sm text-text-main leading-none">{machine.name}</p>
                            <p className="text-[10px] text-text-secondary font-mono mt-1 uppercase tracking-wider">{machine.protocol} • {machine.ip}:{machine.port}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {machine.machineGroup ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                            {machine.machineGroup.name}
                          </span>
                        ) : (
                          <span className="text-[10px] text-text-secondary italic">Aucun groupe</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold border transition-colors ${machine.allowTunneling ? 'bg-success/10 text-success border-success/20' : 'bg-danger/5 text-danger border-danger/20 opacity-40'}`}>TUNNEL</span>
                          <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold border transition-colors ${machine.allowRebound ? 'bg-success/10 text-success border-success/20' : 'bg-danger/5 text-danger border-danger/20 opacity-40'}`}>REBOND</span>
                          <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold border transition-colors ${machine.allowCopyPaste ? 'bg-success/10 text-success border-success/20' : 'bg-danger/5 text-danger border-danger/20 opacity-40'}`}>CLIPBOARD</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => openPermissions(machine)} className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-md transition-all" title="Permissions">
                            <ShieldCheck size={18} />
                          </button>
                          <button onClick={() => openEditMachine(machine)} className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-md transition-all" title="Modifier">
                            <Edit2 size={18} />
                          </button>
                          <button onClick={() => deleteMachine(machine.id)} className="p-2 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-md transition-all" title="Supprimer">
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {machines.length === 0 && !loading && (
              <div className="text-center py-20 bg-background-surface">
                <Server className="mx-auto text-neutral mb-4 opacity-20" size={48} />
                <p className="text-text-secondary text-sm italic">Aucune machine configurée.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* GROUPS TAB */}
      {activeTab === 'groups' && (
        <>
          <div className="flex justify-end">
            <button 
              onClick={() => { 
                setEditingId(null); 
                setGroupFormData({ name: '', description: '' }); 
                setIsGroupModalOpen(true); 
              }} 
              className="btn-primary flex items-center gap-2 text-sm shadow-sm"
            >
              <FolderPlus size={18} /> Nouveau groupe
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {machineGroups.map((group) => (
              <div key={group.id} className="card-subtle hover:border-primary/40 hover:shadow-md transition-all group flex flex-col">
                <div className="p-6 flex-grow space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-primary/5 rounded-xl text-primary border border-primary/10">
                        <FolderOpen size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold text-text-main truncate leading-none">{group.name}</h3>
                        <p className="text-[10px] text-text-secondary uppercase tracking-widest mt-1.5 font-medium">
                          {group.machines.length} machine{group.machines.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  </div>

                  {group.description && (
                    <p className="text-xs text-text-secondary line-clamp-2 italic">{group.description}</p>
                  )}

                  <div className="pt-4 border-t border-border-light space-y-2">
                    {group.machines.length > 0 ? (
                      group.machines.slice(0, 3).map((m: any) => (
                        <div key={m.id} className="flex items-center gap-2 text-[11px] text-text-secondary">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                          <span className="truncate">{m.name}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-[11px] text-text-secondary opacity-40 italic">Aucune machine dans ce groupe</p>
                    )}
                    {group.machines.length > 3 && (
                      <p className="text-[9px] text-primary font-bold uppercase tracking-tighter">+{group.machines.length - 3} autre{group.machines.length - 3 !== 1 ? 's' : ''}</p>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-background-app border-t border-border-light flex gap-2">
                  <button
                    onClick={() => openGroupPermissions(group)}
                    className="flex-1 flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase bg-background-surface text-text-secondary hover:text-primary hover:border-primary/50 border border-border-light rounded-md transition-all shadow-sm"
                  >
                    <ShieldCheck size={14} /> Droits
                  </button>
                  <button
                    onClick={() => openEditGroup(group)}
                    className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-md transition-all"
                    title="Modifier"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => deleteGroup(group.id)}
                    className="p-2 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-md transition-all"
                    title="Supprimer"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {machineGroups.length === 0 && !loading && (
            <div className="text-center py-20 card-subtle bg-background-surface">
              <FolderOpen className="mx-auto text-neutral mb-4 opacity-20" size={48} />
              <p className="text-text-secondary text-sm italic">Aucun groupe de machines configuré.</p>
            </div>
          )}
        </>
      )}



      {/* Permissions Modal */}
      {isPermModalOpen && (selectedMachine || selectedMachineGroup) && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-background-surface w-full max-w-2xl rounded-2xl border border-border-light shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300">
            <div className="p-6 border-b border-border-light bg-background-app flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-primary text-white rounded-xl shadow-lg shadow-primary/20">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-text-main leading-none">
                    {selectedMachine ? selectedMachine.name : selectedMachineGroup.name}
                  </h2>
                  <p className="text-[10px] text-text-secondary uppercase tracking-[0.2em] mt-1.5 font-bold">
                    {selectedMachine ? `Serveur: ${selectedMachine.ip}` : 'Gestion des droits par groupe'}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsPermModalOpen(false)} className="p-2 hover:bg-background-surface rounded-full text-text-secondary transition-colors"><X size={24} /></button>
            </div>

            <div className="p-8 space-y-8 overflow-y-auto max-h-[70vh]">
              <div className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-primary">Attribuer un nouvel accès</h3>
                <form onSubmit={handlePermSubmit} className="bg-background-app p-6 rounded-xl border border-border-light flex flex-col gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Type d'entité</label>
                      <select 
                        className="form-input w-full h-11 text-sm font-medium"
                        value={permFormData.targetType}
                        onChange={e => { setPermFormData({ ...permFormData, targetType: e.target.value as any }); setSelectedTarget(null); setSearchQuery(''); }}
                      >
                        <option value="user">Utilisateur</option>
                        <option value="group">Groupe d'utilisateurs</option>
                      </select>
                    </div>
                    
                    <div className="space-y-1.5 relative">
                      <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Rechercher</label>
                      {selectedTarget ? (
                        <div className="flex items-center justify-between w-full h-11 bg-primary/10 border border-primary/30 rounded-lg px-4 animate-in zoom-in-95">
                          <span className="text-sm font-bold text-primary flex items-center gap-2">
                            {permFormData.targetType === 'user' ? <UserIcon size={14} /> : <Users2 size={14} />}
                            {selectedTarget.label}
                          </span>
                          <button onClick={() => setSelectedTarget(null)} className="text-primary hover:bg-primary/20 rounded-full p-1 transition-colors">
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-secondary group-focus-within:text-primary transition-colors">
                            <Search size={16} />
                          </div>
                          <input
                            type="text"
                            className="form-input input-with-icon text-xs h-10 w-full"
                            placeholder={permFormData.targetType === 'user' ? "Email ou nom d'utilisateur..." : "Nom du groupe..."}
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                          />
                          
                          {suggestions.length > 0 && (
                            <div className="absolute z-20 w-full mt-2 bg-background-surface border border-border-light rounded-xl shadow-xl overflow-hidden py-1">
                              {suggestions.map(s => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => { setSelectedTarget(s); setSuggestions([]); setSearchQuery(''); }}
                                  className="w-full px-4 py-2.5 text-left hover:bg-primary/5 flex flex-col border-b border-border-light last:border-0 transition-colors"
                                >
                                  <span className="text-sm font-bold text-text-main">{s.label}</span>
                                  {s.subLabel && <span className="text-[10px] text-text-secondary mt-0.5">{s.subLabel}</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row items-end gap-4 pt-2">
                    <div className="flex-1 w-full space-y-1.5">
                      <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Niveau d'accès</label>
                      <div className="grid grid-cols-3 gap-2">
                        {['VIEWER', 'OPERATOR', 'OWNER'].map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => setPermFormData({ ...permFormData, level: lvl as any })}
                            className={`py-2 rounded-lg text-[10px] font-bold transition-all border ${
                              permFormData.level === lvl 
                                ? 'bg-primary text-white border-primary shadow-sm shadow-primary/20' 
                                : 'bg-background-surface text-text-secondary border-border-light hover:border-primary/30'
                            }`}
                          >
                            {lvl === 'VIEWER' ? 'LECTURE' : lvl === 'OPERATOR' ? 'ACCÈS' : 'GESTION'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button 
                      type="submit" 
                      disabled={!selectedTarget}
                      className="btn-primary h-10 px-8 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale transition-all w-full md:w-auto"
                    >
                      <Plus size={14} /> Accorder
                    </button>
                  </div>
                </form>
              </div>

              <div className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-secondary px-1">Liste des ayants droit</h3>
                <div className="bg-background-app rounded-xl border border-border-light divide-y divide-border-light">
                  {permissions.length === 0 ? (
                    <div className="text-center py-12 px-6">
                      <ShieldAlert size={32} className="mx-auto text-text-secondary opacity-10 mb-3" />
                      <p className="text-xs text-text-secondary italic">Aucun accès spécifique configuré.</p>
                    </div>
                  ) : (
                    permissions.map((perm) => (
                      <div key={perm.id} className="flex items-center justify-between p-4 hover:bg-background-surface transition-colors group">
                        <div className="flex items-center gap-4">
                          <div className={`p-2.5 rounded-xl border ${perm.user ? 'bg-primary/5 text-primary border-primary/10' : 'bg-secondary/5 text-secondary border-secondary/10'}`}>
                            {perm.user ? <UserIcon size={18} /> : <Users2 size={18} />}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-text-main">
                              {perm.user ? (perm.user.username || perm.user.email) : (perm.group?.name || 'Groupe inconnu')}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter ${
                                perm.level === 'OWNER' ? 'bg-danger/10 text-danger border border-danger/20' : 
                                perm.level === 'OPERATOR' ? 'bg-success/10 text-success border border-success/20' : 
                                'bg-primary/10 text-primary border border-primary/20'
                              }`}>
                                {perm.level}
                              </span>
                              <span className="text-[9px] text-text-secondary opacity-60">• {perm.user ? 'Individuel' : 'Groupe'}</span>
                            </div>
                          </div>
                        </div>
                        <button 
                          onClick={() => deletePermission(perm.id)}
                          className="p-2.5 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-xl opacity-0 group-hover:opacity-100 transition-all"
                          title="Supprimer l'accès"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            
            <div className="p-6 bg-background-app border-t border-border-light flex justify-end">
              <button 
                onClick={() => setIsPermModalOpen(false)}
                className="btn-secondary text-xs font-bold uppercase tracking-widest px-10 py-3 shadow-sm"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Machine Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-background-surface w-full max-w-2xl p-10 rounded-2xl border border-border-light shadow-2xl animate-in slide-in-from-bottom-4 duration-300 my-auto">
            <div className="flex justify-between items-center mb-10">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-2xl text-primary border border-primary/20">
                  {editingId ? <Edit2 size={28} /> : <Plus size={28} />}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-text-main leading-none">{editingId ? 'Configuration Machine' : 'Nouvelle Machine'}</h2>
                  <p className="text-[10px] text-text-secondary uppercase tracking-[0.2em] mt-2 font-bold">Paramètres de connexion & Sécurité</p>
                </div>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-background-app rounded-full text-text-secondary transition-colors"><X size={28} /></button>
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary bg-primary/5 w-fit px-2 py-1 rounded border border-primary/10">1. Réseau & Identification</h3>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Désignation</label>
                  <input type="text" className="form-input w-full h-11" placeholder="ex: Serveur Web Production" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-2">
                    <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Adresse Host/IP</label>
                    <input type="text" className="form-input w-full h-11 font-mono text-sm" placeholder="10.0.0.1" required value={formData.ip} onChange={e => setFormData({ ...formData, ip: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Port</label>
                    <input type="number" className="form-input w-full h-11 font-mono text-sm text-center" required value={formData.port} onChange={e => setFormData({ ...formData, port: parseInt(e.target.value) })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Groupe d'inventaire</label>
                  <select className="form-input w-full h-11 font-medium" value={formData.machineGroupId} onChange={e => setFormData({ ...formData, machineGroupId: e.target.value })}>
                    <option value="">Aucun groupe</option>
                    {machineGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Note / Description</label>
                  <textarea className="form-input w-full h-24 py-3 resize-none" placeholder="Description de la machine..." value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })}></textarea>
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary bg-primary/5 w-fit px-2 py-1 rounded border border-primary/10">2. Sécurité SSH & Identifiants</h3>
                
                {/* Fingerprint Field */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1 flex justify-between">
                    Empreinte SHA-256
                    <span className="text-[8px] text-danger">* Requis</span>
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1 group">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-secondary group-focus-within:text-primary transition-colors">
                        <Fingerprint size={16} />
                      </div>
                      <input 
                        type="text" 
                        className="form-input input-with-icon h-11 w-full text-[10px] font-mono" 
                        placeholder="SHA256:..." 
                        required 
                        value={formData.sshFingerprint} 
                        onChange={e => setFormData({ ...formData, sshFingerprint: e.target.value })} 
                      />
                    </div>
                    <button 
                      type="button" 
                      onClick={probeSshFingerprint}
                      disabled={probing}
                      className="p-2.5 bg-background-app border border-border-light rounded-lg text-primary hover:bg-primary/5 transition-all disabled:opacity-50 shadow-sm"
                      title="Récupérer l'empreinte du serveur"
                    >
                      <RefreshCw size={20} className={probing ? 'animate-spin' : ''} />
                    </button>
                  </div>
                  {formData.sshFingerprint && !editingId && (
                    <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex gap-3 animate-in fade-in slide-in-from-top-2">
                      <AlertTriangle size={18} className="text-warning flex-shrink-0" />
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-warning leading-tight font-medium">
                          Vérifiez cette empreinte manuellement. Ne validez que si elle correspond au serveur cible pour éviter toute interception (MITM).
                        </p>
                        <p className="text-[9px] text-warning/80 font-mono bg-warning/5 p-1.5 rounded border border-warning/20">
                          # Vérifier sur le serveur (toutes les clés) :<br/>
                          for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Utilisateur</label>
                  <input type="text" className="form-input w-full h-11 font-medium" placeholder="ex: admin" required value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Mot de Passe</label>
                  <input type="password" name="new-password" title="password" className="form-input w-full h-11" placeholder={editingId ? "Inchangé si vide" : "••••••••"} value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Clé Privée (PEM)</label>
                  <textarea className="form-input w-full h-24 text-[9px] font-mono py-3 resize-none" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={formData.privateKey} onChange={e => setFormData({ ...formData, privateKey: e.target.value })}></textarea>
                </div>
              </div>

              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 border-t border-border-light">
                {[
                  { id: 'allowTunneling', label: 'Port Forwarding', desc: 'Tunnel SSH' },
                  { id: 'allowRebound', label: 'Rebond / Proxy', desc: 'Saut d\'hôte' },
                  { id: 'allowCopyPaste', label: 'Presse-papier', desc: 'Copier/Coller' }
                ].map(opt => (
                  <div key={opt.id} className="flex items-center justify-between p-4 bg-background-app rounded-xl border border-border-light group hover:border-primary/30 transition-colors">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-text-main uppercase tracking-tight">{opt.label}</span>
                      <span className="text-[9px] text-text-secondary opacity-60 font-medium">{opt.desc}</span>
                    </div>
                    <button 
                      type="button" 
                      onClick={() => setFormData({ ...formData, [opt.id]: !(formData as any)[opt.id] })} 
                      className={`transition-all transform active:scale-90 ${(formData as any)[opt.id] ? 'text-primary' : 'text-text-secondary opacity-20'}`}
                    >
                      {(formData as any)[opt.id] ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                    </button>
                  </div>
                ))}
              </div>

              <div className="md:col-span-2 flex justify-end gap-3 mt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary px-8 py-3 text-xs font-bold uppercase tracking-widest shadow-sm">Annuler</button>
                <button type="submit" className="btn-primary px-10 py-3 text-xs font-bold uppercase tracking-widest shadow-lg shadow-primary/20">{editingId ? 'Sauvegarder' : 'Créer l\'hôte'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Machine Group Modal */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-background-surface w-full max-w-xl p-10 rounded-2xl border border-border-light shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex justify-between items-center mb-10">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-2xl text-primary border border-primary/20">
                  <FolderPlus size={28} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-text-main leading-none">{editingId ? 'Paramètres du Groupe' : 'Nouveau Groupe'}</h2>
                  <p className="text-[10px] text-text-secondary uppercase tracking-[0.2em] mt-2 font-bold">Organisation des ressources</p>
                </div>
              </div>
              <button onClick={() => setIsGroupModalOpen(false)} className="p-2 hover:bg-background-app rounded-full text-text-secondary transition-colors"><X size={28} /></button>
            </div>

            <form onSubmit={handleGroupSubmit} className="space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Nom du groupe</label>
                <input type="text" className="form-input w-full h-11" placeholder="ex: Infrastructure Front-End" required value={groupFormData.name} onChange={e => setGroupFormData({ ...groupFormData, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Note / Description</label>
                <textarea className="form-input w-full h-24 py-3 resize-none" placeholder="Décrivez l'usage de ce groupe..." value={groupFormData.description} onChange={e => setGroupFormData({ ...groupFormData, description: e.target.value })}></textarea>
              </div>

              {editingId && (
                <div className="pt-6 border-t border-border-light space-y-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-2 px-1">
                    <Server size={14} /> Machines membres
                  </h3>
                  
                  <div className="flex gap-2">
                    <select 
                      className="form-input flex-1 h-11 text-sm font-medium"
                      value={selectedMachineToAdd}
                      onChange={e => setSelectedMachineToAdd(e.target.value)}
                    >
                      <option value="">Ajouter une machine existante...</option>
                      {machines.filter(m => !m.machineGroupId).map(m => (
                        <option key={m.id} value={m.id}>{m.name} ({m.ip})</option>
                      ))}
                    </select>
                    <button 
                      type="button"
                      onClick={handleAddMachineToGroup}
                      disabled={!selectedMachineToAdd}
                      className="btn-primary h-11 px-4 disabled:opacity-50 transition-all active:scale-95"
                    >
                      <Plus size={20} />
                    </button>
                  </div>

                  <div className="bg-background-app rounded-xl border border-border-light divide-y divide-border-light max-h-48 overflow-y-auto">
                    {currentEditingGroup?.machines.length > 0 ? (
                      currentEditingGroup.machines.map((m: any) => (
                        <div key={m.id} className="p-3.5 flex items-center justify-between hover:bg-background-surface transition-colors group">
                          <div className="flex items-center gap-3">
                            <Server size={14} className="text-primary/70" />
                            <span className="text-xs font-bold text-text-main">{m.name}</span>
                            <span className="text-[9px] text-text-secondary font-mono opacity-50">{m.ip}</span>
                          </div>
                          <button 
                            type="button"
                            onClick={() => handleRemoveMachineFromGroup(m.id)}
                            className="text-text-secondary hover:text-danger p-1.5 hover:bg-danger/5 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            title="Retirer du groupe"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="p-8 text-center text-text-secondary text-xs italic opacity-50">Ce groupe ne contient aucune machine.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-6 border-t border-border-light">
                <button type="button" onClick={() => setIsGroupModalOpen(false)} className="btn-secondary px-8 py-3 text-xs font-bold uppercase tracking-widest">Annuler</button>
                <button type="submit" className="btn-primary px-10 py-3 text-xs font-bold uppercase tracking-widest shadow-lg shadow-primary/20">{editingId ? 'Sauvegarder' : 'Initialiser le groupe'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminMachines;
