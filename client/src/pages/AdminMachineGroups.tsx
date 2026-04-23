import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  X,
  FolderOpen,
  Server
} from 'lucide-react';
import api from '../services/api';

interface Machine {
  id: string;
  name: string;
  ip: string;
  port: number;
}

interface MachineGroup {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  machines: Machine[];
}

const AdminMachineGroups: React.FC = () => {
  const [groups, setGroups] = useState<MachineGroup[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<MachineGroup | null>(null);

  const [formData, setFormData] = useState({ name: '', description: '' });

  const fetchGroups = async () => {
    try {
      const response = await api.get('/machine-groups');
      setGroups(response.data as any);
    } catch (error) {
      console.error('Fetch failed:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.patch(`/machine-groups/${editingId}`, formData);
      } else {
        await api.post('/machine-groups', formData);
      }
      setIsModalOpen(false);
      setEditingId(null);
      setFormData({ name: '', description: '' });
      fetchGroups();
    } catch (error) {
      alert('Erreur lors de l\'enregistrement');
    }
  };

  const deleteGroup = async (id: string) => {
    if (!confirm('Supprimer ce groupe et dégrouper les machines ?')) return;
    try {
      await api.delete(`/machine-groups/${id}`);
      fetchGroups();
    } catch (err) {
      alert('Erreur suppression');
    }
  };

  const openEditGroup = (group: MachineGroup) => {
    setEditingId(group.id);
    setFormData({
      name: group.name,
      description: group.description || '',
    });
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-text-main">Groupes de Machines</h1>
          <p className="text-text-secondary mt-1 text-sm">Organisez vos machines par groupes pour gérer les accès facilement.</p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setFormData({ name: '', description: '' });
            setIsModalOpen(true);
          }}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <Plus size={18} /> Ajouter un groupe
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((group) => (
          <div
            key={group.id}
            className="card-subtle border border-border-light hover:border-primary/30 transition-all cursor-pointer group"
            onClick={() => setSelectedGroup(group)}
          >
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <div className="p-3 bg-primary/10 rounded-lg text-primary group-hover:bg-primary/20 transition-colors">
                    <FolderOpen size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-text-main truncate">{group.name}</h3>
                    <p className="text-[10px] text-text-secondary uppercase tracking-wider">
                      {group.machines.length} machine{group.machines.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>

              {group.description && (
                <p className="text-xs text-text-secondary line-clamp-2">{group.description}</p>
              )}

              <div className="pt-4 border-t border-border-light space-y-2">
                {group.machines.length > 0 ? (
                  group.machines.slice(0, 3).map((machine) => (
                    <div key={machine.id} className="flex items-center gap-2 text-[11px]">
                      <Server size={12} className="text-primary flex-shrink-0" />
                      <span className="text-text-secondary truncate">{machine.name}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-text-secondary italic">Aucune machine</p>
                )}
                {group.machines.length > 3 && (
                  <p className="text-[10px] text-primary font-bold">+{group.machines.length - 3} autre{group.machines.length - 3 !== 1 ? 's' : ''}</p>
                )}
              </div>

              <div className="flex gap-1 pt-2 border-t border-border-light">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditGroup(group);
                  }}
                  className="flex-1 p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-md transition-all text-[11px] font-bold uppercase"
                  title="Modifier"
                >
                  <Edit2 size={14} className="mx-auto" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteGroup(group.id);
                  }}
                  className="flex-1 p-2 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-md transition-all text-[11px] font-bold uppercase"
                  title="Supprimer"
                >
                  <Trash2 size={14} className="mx-auto" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {groups.length === 0 && !loading && (
        <div className="text-center py-12 card-subtle">
          <FolderOpen className="mx-auto text-neutral mb-4 opacity-20" size={48} />
          <p className="text-text-secondary text-sm italic">Aucun groupe de machines.</p>
        </div>
      )}

      {/* Group Details Modal */}
      {selectedGroup && (
        <div
          className="fixed inset-0 bg-text-main/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedGroup(null)}
        >
          <div
            className="bg-background-surface w-full max-w-2xl p-8 rounded-lg border border-border-light shadow-xl animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <FolderOpen size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-text-main">{selectedGroup.name}</h2>
                  {selectedGroup.description && (
                    <p className="text-xs text-text-secondary">{selectedGroup.description}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedGroup(null)}
                className="p-2 hover:bg-background-app rounded-full text-text-secondary transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {selectedGroup.machines.length > 0 ? (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {selectedGroup.machines.map((machine) => (
                  <div
                    key={machine.id}
                    className="flex items-center gap-3 p-3 bg-background-app rounded-lg border border-border-light"
                  >
                    <div className="p-2 bg-primary/5 rounded-md text-primary">
                      <Server size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-text-main">{machine.name}</p>
                      <p className="text-[10px] text-text-secondary font-mono uppercase tracking-wider">
                        {machine.ip}:{machine.port}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 border border-dashed border-border-light rounded-lg">
                <Server className="mx-auto text-neutral/30 mb-2" size={32} />
                <p className="text-text-secondary text-sm italic">Aucune machine dans ce groupe.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Creation/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-text-main/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-background-surface w-full max-w-md p-8 rounded-lg border border-border-light shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold text-text-main mb-6">
              {editingId ? 'Modifier le groupe' : 'Ajouter un groupe'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-text-secondary">Nom du groupe</label>
                <input
                  required
                  className="form-input w-full"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="ex: Production, Développement..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-text-secondary">Description (optionnel)</label>
                <textarea
                  className="form-input w-full resize-none"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Décrivez le rôle de ce groupe..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingId(null);
                  }}
                  className="btn-secondary flex-1 text-sm"
                >
                  Annuler
                </button>
                <button type="submit" className="btn-primary flex-1 text-sm">
                  {editingId ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminMachineGroups;
