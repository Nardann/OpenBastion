import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Users2,
  X,
  Mail,
  Lock,
  FileText,
  Trash2,
  Edit2,
  Plus,
  User as UserIcon,
  Tag,
  LogOut,
  FolderPlus,
  ShieldOff,
} from 'lucide-react';
import api from '../services/api';

interface User {
  id: string;
  email: string;
  username?: string;
  role: string;
  authMethod: string;
  isOtpEnabled?: boolean;
  createdAt: string;
  groups: Array<{ id: string; name: string }>;
}

interface Group {
  id: string;
  name: string;
  description: string;
  users: Array<{ id: string, email: string, username?: string }>;
  _count: { users: number };
}

const AdminUsers: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'groups'>('users');
  const [loading, setLoading] = useState(true);
  
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [userFormData, setUserFormData] = useState({ email: '', username: '', password: '', role: 'USER' });
  const [groupFormData, setGroupFormData] = useState({ name: '', description: '' });
  const [selectedUserToAdd, setSelectedUserToAdd] = useState('');

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [usersRes, groupsRes] = await Promise.all([
        api.get('/users'),
        api.get('/groups')
      ]);
      setUsers(usersRes.data as any);
      setGroups(groupsRes.data as any);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        const { password, ...updateData } = userFormData;
        const payload = password ? userFormData : updateData;
        await api.patch(`/users/${editingId}`, payload);
      } else {
        await api.post('/users', userFormData);
      }
      setIsUserModalOpen(false);
      setEditingId(null);
      setUserFormData({ email: '', username: '', password: '', role: 'USER' });
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Erreur lors de l\'enregistrement de l\'utilisateur');
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.patch(`/groups/${editingId}`, groupFormData);
      } else {
        await api.post('/groups', groupFormData);
      }
      setIsGroupModalOpen(false);
      setEditingId(null);
      setGroupFormData({ name: '', description: '' });
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Erreur lors de l\'enregistrement du groupe');
    }
  };

  const handleAddUserToGroup = async () => {
    if (!editingId || !selectedUserToAdd) return;
    try {
      await api.post(`/groups/${editingId}/users`, { userId: selectedUserToAdd });
      setSelectedUserToAdd('');
      fetchData();
    } catch (err) {
      alert('Erreur lors de l\'ajout de l\'utilisateur');
    }
  };

  const handleRemoveUserFromGroup = async (userId: string) => {
    if (!editingId) return;
    try {
      await api.delete(`/groups/${editingId}/users/${userId}`);
      fetchData();
    } catch (err) {
      alert('Erreur lors de la suppression de l\'utilisateur');
    }
  };

  const handleDisableOtp = async (user: any) => {
    if (!confirm(`Désactiver l'OTP pour ${user.username || user.email} ?`))
      return;
    try {
      await api.post(`/users/${user.id}/disable-otp`);
      alert('OTP désactivé pour cet utilisateur.');
      fetchData();
    } catch (err) {
      alert('Erreur lors de la désactivation');
    }
  };

  const deleteUser = async (id: string) => {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    try {
      await api.delete(`/users/${id}`);
      fetchData();
    } catch (err) {
      alert('Erreur suppression');
    }
  };

  const deleteGroup = async (id: string) => {
    if (!confirm('Supprimer ce groupe ?')) return;
    try {
      await api.delete(`/groups/${id}`);
      fetchData();
    } catch (err) {
      alert('Erreur suppression');
    }
  };

  const revokeUserTokens = async (id: string) => {
    if (!confirm('Révoquer toutes les sessions de cet utilisateur ?')) return;
    try {
      await api.post(`/users/${id}/revoke-tokens`);
      alert('Sessions révoquées avec succès.');
    } catch (err) {
      alert('Erreur lors de la révocation');
    }
  };

  const openEditUser = (user: User) => {
    setEditingId(user.id);
    setUserFormData({ 
      email: user.email, 
      username: user.username || '', 
      password: '', 
      role: user.role 
    });
    setIsUserModalOpen(true);
  };

  const openEditGroup = (group: Group) => {
    setEditingId(group.id);
    setGroupFormData({ name: group.name, description: group.description || '' });
    setIsGroupModalOpen(true);
  };

  const currentEditingGroup = groups.find(g => g.id === editingId);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-text-main leading-tight tracking-tight">Identités & Accès</h1>
          <p className="text-text-secondary mt-1 text-sm">Gérez les utilisateurs, les groupes et leurs privilèges d'accès.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-background-surface p-1 rounded-lg border border-border-light w-fit shadow-sm">
        <button 
          onClick={() => setActiveTab('users')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'users' ? 'bg-background-app text-primary shadow-sm' : 'text-text-secondary hover:text-text-main'}`}
        >
          <Users size={16} />
          Utilisateurs
        </button>
        <button 
          onClick={() => setActiveTab('groups')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'groups' ? 'bg-background-app text-primary shadow-sm' : 'text-text-secondary hover:text-text-main'}`}
        >
          <Users2 size={16} />
          Groupes
        </button>
      </div>

      {activeTab === 'users' ? (
        <>
          <div className="flex justify-end">
            <button 
              onClick={() => { setEditingId(null); setUserFormData({ email: '', username: '', password: '', role: 'USER' }); setIsUserModalOpen(true); }}
              className="btn-primary flex items-center gap-2 text-sm shadow-sm"
            >
              <UserPlus size={18} /> Créer un utilisateur
            </button>
          </div>

          <div className="card-subtle overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="table-header border-b border-border-light bg-background-app">
                    <th className="px-6 py-4">Utilisateur</th>
                    <th className="px-6 py-4 text-center">Méthode</th>
                    <th className="px-6 py-4 text-center">Groupes</th>
                    <th className="px-6 py-4 text-center">Rôle</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {users.map((user) => (
                    <tr key={user.id} className="group hover:bg-background-app transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center text-primary font-bold uppercase text-xs border border-primary/10">
                            {user.username?.[0] || user.email[0]}
                          </div>
                          <div>
                            <div className="font-bold text-sm text-text-main leading-none">{user.username || 'N/A'}</div>
                            <div className="text-[10px] text-text-secondary font-mono leading-none mt-1.5">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          user.authMethod === 'LOCAL' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 
                          user.authMethod === 'LDAP' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 
                          'bg-purple-500/10 text-purple-500 border border-purple-500/20'
                        }`}>
                          {user.authMethod}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap justify-center gap-1">
                          {user.groups.length > 0 ? (
                            user.groups.map(g => (
                              <span key={g.id} className="px-2 py-0.5 bg-background-app rounded-full text-[10px] font-bold text-text-secondary flex items-center gap-1 border border-border-light">
                                <Tag size={8} /> {g.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-text-secondary opacity-30 italic">Aucun</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${user.role === 'ADMIN' ? 'bg-danger/10 text-danger border border-danger/20' : 'bg-background-app text-text-secondary border border-border-light'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          {user.isOtpEnabled && (
                            <button
                              onClick={() => handleDisableOtp(user)}
                              className="p-2 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-md transition-all"
                              title="Désactiver l'OTP"
                            >
                              <ShieldOff size={18} />
                            </button>
                          )}
                          <button
                            onClick={() => revokeUserTokens(user.id)}
                            className="p-2 text-text-secondary hover:text-warning hover:bg-warning/5 rounded-md transition-all"
                            title="Révoquer les sessions"
                          >
                            <LogOut size={18} />
                          </button>
                          <button onClick={() => openEditUser(user)} className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-md transition-all" title="Modifier">
                            <Edit2 size={18} />
                          </button>
                          <button onClick={() => deleteUser(user.id)} className="p-2 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-md transition-all" title="Supprimer">
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {users.length === 0 && !loading && (
              <div className="text-center py-20 bg-background-surface">
                <Users className="mx-auto text-neutral mb-4 opacity-20" size={48} />
                <p className="text-text-secondary text-sm italic">Aucun utilisateur configuré.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-end">
            <button 
              onClick={() => { setEditingId(null); setGroupFormData({ name: '', description: '' }); setIsGroupModalOpen(true); }}
              className="btn-primary flex items-center gap-2 text-sm shadow-sm"
            >
              <FolderPlus size={18} /> Nouveau groupe
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {groups.map((group) => (
              <div key={group.id} className="card-subtle hover:border-primary/40 hover:shadow-md transition-all group flex flex-col">
                <div className="p-6 flex-grow space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-primary/5 rounded-xl text-primary border border-primary/10">
                        <Users2 size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold text-text-main truncate leading-none">{group.name}</h3>
                        <p className="text-[10px] text-text-secondary uppercase tracking-widest mt-2 font-bold opacity-60">
                          {group._count.users} membre{group._count.users !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  </div>

                  {group.description && (
                    <p className="text-xs text-text-secondary line-clamp-2 italic leading-relaxed">{group.description}</p>
                  )}

                  <div className="pt-4 border-t border-border-light space-y-2">
                    {group.users && group.users.length > 0 ? (
                      group.users.slice(0, 3).map((u: any) => (
                        <div key={u.id} className="flex items-center gap-2.5 text-[11px] text-text-secondary">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                          <span className="truncate font-medium">{u.username || u.email}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-[11px] text-text-secondary opacity-40 italic">Aucun membre dans ce groupe</p>
                    )}
                    {group._count.users > 3 && (
                      <p className="text-[9px] text-primary font-bold uppercase tracking-tighter mt-2">+{group._count.users - 3} autre{group._count.users - 3 !== 1 ? 's' : ''}</p>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-background-app border-t border-border-light flex gap-2">
                  <button
                    onClick={() => openEditGroup(group)}
                    className="flex-1 flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase bg-background-surface text-text-secondary hover:text-primary hover:border-primary/50 border border-border-light rounded-md transition-all shadow-sm"
                  >
                    <Users size={14} /> Gérer les membres
                  </button>
                  <button
                    onClick={() => deleteGroup(group.id)}
                    className="p-2 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-md transition-all"
                    title="Supprimer le groupe"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {groups.length === 0 && !loading && (
            <div className="text-center py-20 card-subtle bg-background-surface">
              <Users2 className="mx-auto text-neutral mb-4 opacity-20" size={48} />
              <p className="text-text-secondary text-sm italic">Aucun groupe d'utilisateurs configuré.</p>
            </div>
          )}
        </>
      )}

      {/* User Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-background-surface w-full max-w-md p-10 rounded-2xl border border-border-light shadow-2xl animate-in slide-in-from-bottom-4 duration-300 my-auto">
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-2xl text-primary border border-primary/20">
                  {editingId ? <Edit2 size={24} /> : <UserPlus size={24} />}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-text-main leading-none">{editingId ? 'Modifier Profil' : 'Nouvel Utilisateur'}</h2>
                  <p className="text-[10px] text-text-secondary uppercase tracking-widest mt-2 font-bold">Gestion des accès locaux</p>
                </div>
              </div>
              <button onClick={() => setIsUserModalOpen(false)} className="p-2 hover:bg-background-app rounded-full text-text-secondary transition-colors"><X size={24} /></button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Adresse Email</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-secondary group-focus-within:text-primary transition-colors">
                    <Mail size={16} />
                  </div>
                  <input required type="email" className="form-input input-with-icon h-11 text-sm" placeholder="user@domain.com" value={userFormData.email} onChange={e => setUserFormData({...userFormData, email: e.target.value})} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Nom d'utilisateur</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-secondary group-focus-within:text-primary transition-colors">
                    <UserIcon size={16} />
                  </div>
                  <input type="text" className="form-input input-with-icon h-11 text-sm" placeholder="Pseudo..." value={userFormData.username} onChange={e => setUserFormData({...userFormData, username: e.target.value})} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{editingId ? 'Changer le mot de passe (laisser vide)' : 'Mot de passe initial'}</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-secondary group-focus-within:text-primary transition-colors">
                    <Lock size={16} />
                  </div>
                  <input required={!editingId} type="password" password-field="true" className="form-input input-with-icon h-11 text-sm" placeholder="••••••••" value={userFormData.password} onChange={e => setUserFormData({...userFormData, password: e.target.value})} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Privilèges Administratifs</label>
                <select className="form-input h-11 text-sm font-medium" value={userFormData.role} onChange={e => setUserFormData({...userFormData, role: e.target.value})}>
                  <option value="USER">Utilisateur Standard</option>
                  <option value="ADMIN">Administrateur Système</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t border-border-light">
                <button type="button" onClick={() => setIsUserModalOpen(false)} className="btn-secondary px-8 py-3 text-xs font-bold uppercase tracking-widest shadow-sm">Annuler</button>
                <button type="submit" className="btn-primary px-10 py-3 text-xs font-bold uppercase tracking-widest shadow-lg shadow-primary/20">
                  {editingId ? 'Sauvegarder' : 'Créer le profil'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Group Modal */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-background-surface w-full max-w-3xl rounded-2xl border border-border-light shadow-2xl overflow-hidden flex flex-col md:flex-row animate-in slide-in-from-bottom-4 duration-300">
            <div className={`p-10 ${editingId ? "md:w-[45%]" : "w-full"}`}>
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-2xl text-primary border border-primary/20">
                    <FolderPlus size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-text-main leading-none">{editingId ? 'Paramètres Groupe' : 'Nouveau Groupe'}</h2>
                    <p className="text-[10px] text-text-secondary uppercase tracking-widest mt-2 font-bold">Rôles et permissions</p>
                  </div>
                </div>
                {!editingId && <button onClick={() => setIsGroupModalOpen(false)} className="p-2 hover:bg-background-app rounded-full text-text-secondary transition-colors"><X size={24} /></button>}
              </div>

              <form onSubmit={handleCreateGroup} className="space-y-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Nom du Groupe</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-secondary group-focus-within:text-primary transition-colors">
                      <Users2 size={16} />
                    </div>
                    <input required type="text" placeholder="ex: Administrateurs Réseau" className="form-input input-with-icon h-11 text-sm" value={groupFormData.name} onChange={e => setGroupFormData({...groupFormData, name: e.target.value})} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">Note / Description</label>
                  <div className="relative group">
                    <div className="absolute left-3.5 top-3.5 flex items-center pointer-events-none text-text-secondary group-focus-within:text-primary transition-colors">
                      <FileText size={16} />
                    </div>
                    <textarea className="form-input input-with-icon w-full h-24 py-3 resize-none text-sm" placeholder="Description du rôle de ce groupe..." value={groupFormData.description} onChange={e => setGroupFormData({...groupFormData, description: e.target.value})}></textarea>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-6 border-t border-border-light">
                  <button type="button" onClick={() => setIsGroupModalOpen(false)} className="btn-secondary px-6 py-2 text-xs font-bold uppercase tracking-widest">Annuler</button>
                  <button type="submit" className="btn-primary px-8 py-2 text-xs font-bold uppercase tracking-widest">
                    {editingId ? 'Enregistrer' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>

            {editingId && (
              <div className="md:w-[55%] bg-background-app border-t md:border-t-0 md:border-l border-border-light p-10 flex flex-col">
                <div className="flex justify-between items-center mb-8">
                  <div className="flex items-center gap-3">
                    <Users size={20} className="text-primary" />
                    <h3 className="font-bold text-text-main">Membres du groupe</h3>
                  </div>
                  <button onClick={() => setIsGroupModalOpen(false)} className="p-2 hover:bg-background-surface rounded-full text-text-secondary transition-colors hidden md:flex"><X size={24} /></button>
                </div>

                <div className="flex gap-2 mb-6">
                  <select 
                    className="form-input flex-1 h-11 text-sm font-medium"
                    value={selectedUserToAdd}
                    onChange={e => setSelectedUserToAdd(e.target.value)}
                  >
                    <option value="">Ajouter un membre...</option>
                    {users
                      .filter(u => !currentEditingGroup?.users.some(m => m.id === u.id))
                      .map(u => (
                        <option key={u.id} value={u.id}>{u.username || u.email}</option>
                      ))
                    }
                  </select>
                  <button 
                    onClick={handleAddUserToGroup}
                    disabled={!selectedUserToAdd}
                    className="btn-primary h-11 px-4 disabled:opacity-50 transition-all active:scale-95"
                  >
                    <Plus size={20} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto max-h-[350px] space-y-2 pr-1">
                  {currentEditingGroup?.users.map(member => (
                    <div key={member.id} className="flex justify-between items-center p-3.5 bg-background-surface rounded-xl border border-border-light group/item hover:border-primary/30 transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-primary/5 flex items-center justify-center text-primary font-bold text-[10px]">
                          {member.username?.[0] || member.email[0]}
                        </div>
                        <span className="text-sm font-bold text-text-main truncate max-w-[150px]">{member.username || member.email}</span>
                      </div>
                      <button 
                        onClick={() => handleRemoveUserFromGroup(member.id)}
                        className="opacity-0 group-hover/item:opacity-100 p-1.5 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-lg transition-all"
                        title="Retirer du groupe"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {currentEditingGroup?.users.length === 0 && (
                    <div className="text-center py-12 border-2 border-dashed border-border-light rounded-2xl">
                      <Users size={32} className="mx-auto text-text-secondary opacity-10 mb-2" />
                      <p className="text-xs text-text-secondary italic">Ce groupe est vide.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminUsers;
