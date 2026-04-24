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
import { useLang } from '../context/LangContext';

const AdminMachines = () => {
  const { t } = useLang();
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
    machineGroupId: '',
    rdpSecurity: 'NLA' as 'ANY' | 'RDP' | 'TLS' | 'NLA',
    rdpIgnoreCert: false,
    rdpDomain: ''
  });

  const [groupFormData, setGroupFormData] = useState({ name: '', description: '' });

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
  const [rdpEnabled, setRdpEnabled] = useState(false);

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
    api.get('/features').then(res => setRdpEnabled((res.data as any).rdp === true)).catch(() => {});
  }, [activeTab]);

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
        }).slice(0, 5);

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
      alert(t('adminMachines.modal.fingerprintIpRequired'));
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
      alert(t('adminMachines.modal.fingerprintError'));
    } finally {
      setProbing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const submitData: any = {
        name: formData.name,
        ip: formData.ip,
        port: Number(formData.port),
        protocol: formData.protocol,
        description: formData.description,
        username: formData.username,
        allowTunneling: formData.allowTunneling,
        allowRebound: formData.allowRebound,
        allowCopyPaste: formData.allowCopyPaste,
      };

      if (formData.protocol === 'SSH') {
        submitData.sshFingerprint = formData.sshFingerprint;
        if (formData.privateKey) submitData.privateKey = formData.privateKey;
      } else if (formData.protocol === 'RDP') {
        submitData.rdpSecurity = formData.rdpSecurity;
        submitData.rdpIgnoreCert = formData.rdpIgnoreCert;
        if (formData.rdpDomain) submitData.rdpDomain = formData.rdpDomain;
      }

      if (formData.machineGroupId) submitData.machineGroupId = formData.machineGroupId;
      if (formData.password) submitData.password = formData.password;

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
        machineGroupId: '',
        rdpSecurity: 'NLA', rdpIgnoreCert: false, rdpDomain: ''
      });
      fetchData();
    } catch (err: any) {
      alert(err.message || t('adminMachines.errors.saveError'));
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
      alert(t('adminMachines.errors.saveError'));
    }
  };

  const deleteMachine = async (id: string) => {
    if (!confirm(t('adminMachines.errors.deleteMachineConfirm'))) return;
    try {
      await api.delete(`/machines/${id}`);
      fetchMachines();
    } catch (err) { alert(t('adminMachines.errors.deleteError')); }
  };

  const deleteGroup = async (id: string) => {
    if (!confirm(t('adminMachines.errors.deleteGroupConfirm'))) return;
    try {
      await api.delete(`/machine-groups/${id}`);
      fetchGroups();
    } catch (error) {
      alert(t('adminMachines.errors.deleteError'));
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
      machineGroupId: machine.machineGroupId || '',
      rdpSecurity: machine.rdpSecurity || 'NLA',
      rdpIgnoreCert: !!machine.rdpIgnoreCert,
      rdpDomain: machine.rdpDomain || ''
    });
    setIsModalOpen(true);
  };

  const openEditGroup = (group: any) => {
    setEditingId(group.id);
    setGroupFormData({ name: group.name, description: group.description || '' });
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
      const data: any = { level: permFormData.level };
      if (permFormData.targetType === 'user') data.userId = selectedTarget.id;
      else data.groupId = selectedTarget.id;
      if (selectedMachine) data.machineId = selectedMachine.id;
      else data.machineGroupId = selectedMachineGroup.id;

      await api.post('/permissions', data);
      setSelectedTarget(null);
      setSearchQuery('');
      fetchPermissions(selectedMachine?.id, selectedMachineGroup?.id);
    } catch (err: any) { alert(err.message || t('adminMachines.errors.addError')); }
  };

  const deletePermission = async (id: string) => {
    try {
      await api.delete(`/permissions/${id}`);
      fetchPermissions(selectedMachine?.id, selectedMachineGroup?.id);
    } catch (err) { alert(t('adminMachines.errors.deleteError')); }
  };

  const handleAddMachineToGroup = async () => {
    if (!editingId || !selectedMachineToAdd) return;
    try {
      await api.patch(`/machines/${selectedMachineToAdd}/assign-group`, { machineGroupId: editingId });
      setSelectedMachineToAdd('');
      fetchGroups();
      fetchMachines();
    } catch (error) {
      alert(t('adminMachines.errors.addError'));
    }
  };

  const handleRemoveMachineFromGroup = async (machineId: string) => {
    try {
      await api.patch(`/machines/${machineId}/assign-group`, { machineGroupId: null });
      fetchGroups();
      fetchMachines();
    } catch (error) {
      alert(t('adminMachines.errors.removeError'));
    }
  };

  const currentEditingGroup = machineGroups.find(g => g.id === editingId);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-text-main">{t('adminMachines.title')}</h1>
          <p className="text-text-secondary mt-1 text-sm">{t('adminMachines.subtitle')}</p>
        </div>
      </div>

      <div className="flex gap-2 bg-background-surface p-1 rounded-lg border border-border-light w-fit">
        <button
          onClick={() => setActiveTab('machines')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'machines' ? 'bg-background-app text-primary shadow-sm' : 'text-text-secondary hover:text-text-main'}`}
        >
          <div className="flex items-center gap-2">
            <Server size={16} />
            {t('adminMachines.tabMachines')}
          </div>
        </button>
        <button
          onClick={() => setActiveTab('groups')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'groups' ? 'bg-background-app text-primary shadow-sm' : 'text-text-secondary hover:text-text-main'}`}
        >
          <div className="flex items-center gap-2">
            <FolderOpen size={16} />
            {t('adminMachines.tabGroups')}
          </div>
        </button>
      </div>

      {activeTab === 'machines' && (
        <>
          <div className="flex justify-end">
            <button onClick={() => { setEditingId(null); setFormData({ name: '', ip: '', port: 22, protocol: 'SSH', description: '', sshFingerprint: '', username: '', password: '', privateKey: '', allowTunneling: false, allowRebound: false, allowCopyPaste: false, machineGroupId: '', rdpSecurity: 'NLA', rdpIgnoreCert: false, rdpDomain: '' }); setIsModalOpen(true); }} className="btn-primary flex items-center gap-2 text-sm shadow-sm">
              <Plus size={18} /> {t('adminMachines.addMachine')}
            </button>
          </div>

          <div className="card-subtle overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="table-header border-b border-border-light">
                  <tr>
                    <th className="px-6 py-4">{t('adminMachines.cols.name')}</th>
                    <th className="px-6 py-4">{t('adminMachines.cols.group')}</th>
                    <th className="px-6 py-4 text-center">{t('adminMachines.cols.security')}</th>
                    <th className="px-6 py-4 text-right">{t('adminMachines.cols.actions')}</th>
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
                          <span className="text-[10px] text-text-secondary italic">{t('common.noGroup')}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold border transition-colors ${machine.allowTunneling ? 'bg-success/10 text-success border-success/20' : 'bg-danger/5 text-danger border-danger/20 opacity-40'}`}>{t('adminMachines.flags.tunnel')}</span>
                          <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold border transition-colors ${machine.allowRebound ? 'bg-success/10 text-success border-success/20' : 'bg-danger/5 text-danger border-danger/20 opacity-40'}`}>{t('adminMachines.flags.rebound')}</span>
                          <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold border transition-colors ${machine.allowCopyPaste ? 'bg-success/10 text-success border-success/20' : 'bg-danger/5 text-danger border-danger/20 opacity-40'}`}>{t('adminMachines.flags.clipboard')}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => openPermissions(machine)} className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-md transition-all" title={t('common.permissions')}>
                            <ShieldCheck size={18} />
                          </button>
                          <button onClick={() => openEditMachine(machine)} className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-md transition-all" title={t('common.edit')}>
                            <Edit2 size={18} />
                          </button>
                          <button onClick={() => deleteMachine(machine.id)} className="p-2 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-md transition-all" title={t('common.delete')}>
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
                <p className="text-text-secondary text-sm italic">{t('adminMachines.noMachines')}</p>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'groups' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => { setEditingId(null); setGroupFormData({ name: '', description: '' }); setIsGroupModalOpen(true); }}
              className="btn-primary flex items-center gap-2 text-sm shadow-sm"
            >
              <FolderPlus size={18} /> {t('adminMachines.addGroup')}
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
                      <p className="text-[11px] text-text-secondary opacity-40 italic">{t('adminMachines.noMachinesInGroup')}</p>
                    )}
                    {group.machines.length > 3 && (
                      <p className="text-[9px] text-primary font-bold uppercase tracking-tighter">+{group.machines.length - 3}</p>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-background-app border-t border-border-light flex gap-2">
                  <button
                    onClick={() => openGroupPermissions(group)}
                    className="flex-1 flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase bg-background-surface text-text-secondary hover:text-primary hover:border-primary/50 border border-border-light rounded-md transition-all shadow-sm"
                  >
                    <ShieldCheck size={14} /> {t('common.permissions')}
                  </button>
                  <button
                    onClick={() => openEditGroup(group)}
                    className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-md transition-all"
                    title={t('common.edit')}
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => deleteGroup(group.id)}
                    className="p-2 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-md transition-all"
                    title={t('common.delete')}
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
              <p className="text-text-secondary text-sm italic">{t('adminMachines.noGroups')}</p>
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
                    {selectedMachine ? `${t('common.permissions')}: ${selectedMachine.ip}` : t('common.permissions')}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsPermModalOpen(false)} className="p-2 hover:bg-background-surface rounded-full text-text-secondary transition-colors"><X size={24} /></button>
            </div>

            <div className="p-8 space-y-8 overflow-y-auto max-h-[70vh]">
              <div className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-primary">{t('adminMachines.perm.title')}</h3>
                <form onSubmit={handlePermSubmit} className="bg-background-app p-6 rounded-xl border border-border-light flex flex-col gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.perm.entityType')}</label>
                      <select
                        className="form-input w-full h-11 text-sm font-medium"
                        value={permFormData.targetType}
                        onChange={e => { setPermFormData({ ...permFormData, targetType: e.target.value as any }); setSelectedTarget(null); setSearchQuery(''); }}
                      >
                        <option value="user">{t('adminMachines.perm.user')}</option>
                        <option value="group">{t('adminMachines.perm.group')}</option>
                      </select>
                    </div>

                    <div className="space-y-1.5 relative">
                      <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.perm.entityType')}</label>
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
                            placeholder={permFormData.targetType === 'user' ? t('adminMachines.perm.userSearch') : t('adminMachines.perm.groupSearch')}
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
                      <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.perm.level')}</label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['VIEWER', 'OPERATOR', 'OWNER'] as const).map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => setPermFormData({ ...permFormData, level: lvl })}
                            className={`py-2 rounded-lg text-[10px] font-bold transition-all border ${
                              permFormData.level === lvl
                                ? 'bg-primary text-white border-primary shadow-sm shadow-primary/20'
                                : 'bg-background-surface text-text-secondary border-border-light hover:border-primary/30'
                            }`}
                          >
                            {lvl === 'VIEWER' ? t('adminMachines.perm.viewer') : lvl === 'OPERATOR' ? t('adminMachines.perm.operator') : t('adminMachines.perm.owner')}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={!selectedTarget}
                      className="btn-primary h-10 px-8 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale transition-all w-full md:w-auto"
                    >
                      <Plus size={14} /> {t('adminMachines.perm.grant')}
                    </button>
                  </div>
                </form>
              </div>

              <div className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-secondary px-1">{t('adminMachines.perm.list')}</h3>
                <div className="bg-background-app rounded-xl border border-border-light divide-y divide-border-light">
                  {permissions.length === 0 ? (
                    <div className="text-center py-12 px-6">
                      <ShieldAlert size={32} className="mx-auto text-text-secondary opacity-10 mb-3" />
                      <p className="text-xs text-text-secondary italic">{t('adminMachines.perm.empty')}</p>
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
                              {perm.user ? (perm.user.username || perm.user.email) : (perm.group?.name || t('common.none'))}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter ${
                                perm.level === 'OWNER' ? 'bg-danger/10 text-danger border border-danger/20' :
                                perm.level === 'OPERATOR' ? 'bg-success/10 text-success border border-success/20' :
                                'bg-primary/10 text-primary border border-primary/20'
                              }`}>
                                {perm.level}
                              </span>
                              <span className="text-[9px] text-text-secondary opacity-60">• {perm.user ? t('adminMachines.perm.individual') : t('adminMachines.perm.group')}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => deletePermission(perm.id)}
                          className="p-2.5 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-xl opacity-0 group-hover:opacity-100 transition-all"
                          title={t('common.delete')}
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
                {t('common.close')}
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
                  <h2 className="text-2xl font-bold text-text-main leading-none">{editingId ? t('adminMachines.modal.editTitle') : t('adminMachines.modal.newTitle')}</h2>
                  <p className="text-[10px] text-text-secondary uppercase tracking-[0.2em] mt-2 font-bold">{t('adminMachines.modal.subtitle')}</p>
                </div>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-background-app rounded-full text-text-secondary transition-colors"><X size={28} /></button>
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary bg-primary/5 w-fit px-2 py-1 rounded border border-primary/10">{t('adminMachines.modal.section1')}</h3>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.nameLabel')}</label>
                  <input type="text" className="form-input w-full h-11" placeholder={t('adminMachines.modal.namePlaceholder')} required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-3 space-y-2">
                    <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.host')}</label>
                    <input type="text" className="form-input w-full h-11 font-mono text-sm" placeholder="10.0.0.1" required value={formData.ip} onChange={e => setFormData({ ...formData, ip: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.port')}</label>
                    <input type="number" className="form-input w-full h-11 font-mono text-sm text-center" required value={formData.port} onChange={e => setFormData({ ...formData, port: parseInt(e.target.value) })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.protocol')}</label>
                  <select
                    className="form-input w-full h-11 font-medium"
                    value={formData.protocol}
                    onChange={e => {
                      const proto = e.target.value;
                      setFormData({
                        ...formData,
                        protocol: proto,
                        port: formData.port === 22 || formData.port === 3389
                          ? proto === 'RDP' ? 3389 : 22
                          : formData.port,
                      });
                    }}
                  >
                    <option value="SSH">SSH</option>
                    {rdpEnabled && <option value="RDP">RDP</option>}
                  </select>
                  {!rdpEnabled && (
                    <p className="text-[9px] text-text-secondary ml-1 mt-1">
                      {t('adminMachines.modal.rdpDisabled')}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.inventoryGroup')}</label>
                  <select className="form-input w-full h-11 font-medium" value={formData.machineGroupId} onChange={e => setFormData({ ...formData, machineGroupId: e.target.value })}>
                    <option value="">{t('common.noGroup')}</option>
                    {machineGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.description')}</label>
                  <textarea className="form-input w-full h-24 py-3 resize-none" placeholder={t('adminMachines.modal.description')} value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })}></textarea>
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary bg-primary/5 w-fit px-2 py-1 rounded border border-primary/10">
                  {formData.protocol === 'RDP' ? t('adminMachines.modal.section2Rdp') : t('adminMachines.modal.section2Ssh')}
                </h3>

                {formData.protocol === 'SSH' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase text-text-secondary ml-1 flex justify-between">
                      {t('adminMachines.modal.fingerprint')}
                      <span className="text-[8px] text-danger">* {t('common.required')}</span>
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1 group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-secondary group-focus-within:text-primary transition-colors">
                          <Fingerprint size={16} />
                        </div>
                        <input
                          type="text"
                          className="form-input input-with-icon h-11 w-full text-[10px] font-mono"
                          placeholder={t('adminMachines.modal.fingerprintPlaceholder')}
                          required={formData.protocol === 'SSH'}
                          value={formData.sshFingerprint}
                          onChange={e => setFormData({ ...formData, sshFingerprint: e.target.value })}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={probeSshFingerprint}
                        disabled={probing}
                        className="p-2.5 bg-background-app border border-border-light rounded-lg text-primary hover:bg-primary/5 transition-all disabled:opacity-50 shadow-sm"
                        title={t('adminMachines.modal.fingerprintTooltip')}
                      >
                        <RefreshCw size={20} className={probing ? 'animate-spin' : ''} />
                      </button>
                    </div>
                    {formData.sshFingerprint && !editingId && (
                      <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex gap-3 animate-in fade-in slide-in-from-top-2">
                        <AlertTriangle size={18} className="text-warning flex-shrink-0" />
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-warning leading-tight font-medium">
                            {t('adminMachines.modal.fingerprintWarning')}
                          </p>
                          <p className="text-[9px] text-warning/80 font-mono bg-warning/5 p-1.5 rounded border border-warning/20">
                            # Vérifier sur le serveur (toutes les clés) :<br/>
                            for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {formData.protocol === 'RDP' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.rdpSecurity')}</label>
                        <select
                          className="form-input w-full h-11 font-medium"
                          value={formData.rdpSecurity}
                          onChange={e => setFormData({ ...formData, rdpSecurity: e.target.value as any })}
                        >
                          <option value="NLA">{t('adminMachines.modal.rdpNla')}</option>
                          <option value="TLS">{t('adminMachines.modal.rdpTls')}</option>
                          <option value="RDP">{t('adminMachines.modal.rdpRdp')}</option>
                          <option value="ANY">{t('adminMachines.modal.rdpAny')}</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.rdpDomain')}</label>
                        <input
                          type="text"
                          className="form-input w-full h-11 font-medium"
                          placeholder={t('adminMachines.modal.rdpDomainPlaceholder')}
                          value={formData.rdpDomain}
                          onChange={e => setFormData({ ...formData, rdpDomain: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-background-app rounded-xl border border-border-light">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-text-main uppercase tracking-tight">{t('adminMachines.modal.rdpIgnoreCert')}</span>
                        <span className="text-[9px] text-text-secondary opacity-60 font-medium">{t('adminMachines.modal.rdpIgnoreCertHint')}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, rdpIgnoreCert: !formData.rdpIgnoreCert })}
                        className={`transition-all transform active:scale-90 ${formData.rdpIgnoreCert ? 'text-warning' : 'text-text-secondary opacity-20'}`}
                      >
                        {formData.rdpIgnoreCert ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                      </button>
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.username')}</label>
                  <input type="text" className="form-input w-full h-11 font-medium" placeholder={t('adminMachines.modal.usernamePlaceholder')} required value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.passwordLabel')}</label>
                  <input type="password" name="new-password" title="password" className="form-input w-full h-11" placeholder={editingId ? t('adminMachines.modal.passwordPlaceholderEdit') : '••••••••'} value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                </div>
                {formData.protocol === 'SSH' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.privateKey')}</label>
                    <textarea className="form-input w-full h-24 text-[9px] font-mono py-3 resize-none" placeholder={t('adminMachines.modal.privateKeyPlaceholder')} value={formData.privateKey} onChange={e => setFormData({ ...formData, privateKey: e.target.value })}></textarea>
                  </div>
                )}
              </div>

              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 border-t border-border-light">
                {[
                  { id: 'allowTunneling', label: t('adminMachines.modal.tunneling'), desc: t('adminMachines.modal.tunnelingDesc') },
                  { id: 'allowRebound', label: t('adminMachines.modal.rebound'), desc: t('adminMachines.modal.reboundDesc') },
                  { id: 'allowCopyPaste', label: t('adminMachines.modal.clipboard'), desc: t('adminMachines.modal.clipboardDesc') }
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
                <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary px-8 py-3 text-xs font-bold uppercase tracking-widest shadow-sm">{t('common.cancel')}</button>
                <button type="submit" className="btn-primary px-10 py-3 text-xs font-bold uppercase tracking-widest shadow-lg shadow-primary/20">{editingId ? t('adminMachines.modal.save') : t('adminMachines.modal.create')}</button>
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
                  <h2 className="text-2xl font-bold text-text-main leading-none">{editingId ? t('adminMachines.modal.groupEditTitle') : t('adminMachines.modal.groupNewTitle')}</h2>
                  <p className="text-[10px] text-text-secondary uppercase tracking-[0.2em] mt-2 font-bold">{t('adminMachines.modal.groupOrg')}</p>
                </div>
              </div>
              <button onClick={() => setIsGroupModalOpen(false)} className="p-2 hover:bg-background-app rounded-full text-text-secondary transition-colors"><X size={28} /></button>
            </div>

            <form onSubmit={handleGroupSubmit} className="space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.groupName')}</label>
                <input type="text" className="form-input w-full h-11" placeholder={t('adminMachines.modal.groupNamePlaceholder')} required value={groupFormData.name} onChange={e => setGroupFormData({ ...groupFormData, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('adminMachines.modal.groupDescription')}</label>
                <textarea className="form-input w-full h-24 py-3 resize-none" placeholder={t('adminMachines.modal.groupDescPlaceholder')} value={groupFormData.description} onChange={e => setGroupFormData({ ...groupFormData, description: e.target.value })}></textarea>
              </div>

              {editingId && (
                <div className="pt-6 border-t border-border-light space-y-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-2 px-1">
                    <Server size={14} /> {t('adminMachines.modal.groupMembers')}
                  </h3>

                  <div className="flex gap-2">
                    <select
                      className="form-input flex-1 h-11 text-sm font-medium"
                      value={selectedMachineToAdd}
                      onChange={e => setSelectedMachineToAdd(e.target.value)}
                    >
                      <option value="">{t('adminMachines.modal.groupAddMachine')}</option>
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
                            title={t('adminMachines.modal.groupRemove')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="p-8 text-center text-text-secondary text-xs italic opacity-50">{t('adminMachines.modal.groupEmpty')}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-6 border-t border-border-light">
                <button type="button" onClick={() => setIsGroupModalOpen(false)} className="btn-secondary px-8 py-3 text-xs font-bold uppercase tracking-widest">{t('common.cancel')}</button>
                <button type="submit" className="btn-primary px-10 py-3 text-xs font-bold uppercase tracking-widest shadow-lg shadow-primary/20">{editingId ? t('adminMachines.modal.save') : t('adminMachines.modal.groupInit')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminMachines;
