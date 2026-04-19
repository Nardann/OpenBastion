import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Globe,
  Save,
  AlertCircle
} from 'lucide-react';
import api from '../services/api';

interface Provider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: any;
}

const AdminProviders: React.FC = () => {
  const [, setProviders] = useState<Provider[]>([]);
  const [, setLoading] = useState(true);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      const res = await api.get('/auth/providers');
      // For this MVP, if the list is empty, we show potential providers to configure
      setProviders(res.data as any);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Authentification Externe</h1>
        <p className="text-muted-foreground mt-1">Configurez vos annuaires LDAP/AD et vos fournisseurs d'identité SSO.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* LDAP Configuration */}
        <div className="bg-background-surface border border-border-light rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="p-6 border-b border-border-light bg-background-app flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Database className="text-orange-500" size={24} />
              <h2 className="text-xl font-bold">Annuaire LDAP / AD</h2>
            </div>
            <span className="px-2 py-1 bg-secondary text-[10px] font-bold rounded uppercase tracking-wider">Inactif</span>
          </div>
          <div className="p-6 space-y-4 flex-1">
            <div className="space-y-2">
              <label className="text-sm font-medium">URL du Serveur</label>
              <input type="text" placeholder="ldap://domain.local:389" className="w-full px-4 py-2 bg-background-surface border border-border-light rounded-md text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Base de recherche (Search Base)</label>
              <input type="text" placeholder="dc=domain,dc=local" className="w-full px-4 py-2 bg-background-surface border border-border-light rounded-md text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Compte de liaison (Bind DN)</label>
              <input type="text" placeholder="cn=admin,dc=domain,dc=local" className="w-full px-4 py-2 bg-background-surface border border-border-light rounded-md text-sm" />
            </div>
          </div>
          <div className="p-4 bg-background-app border-t border-border-light">
            <button className="btn-primary w-full flex items-center justify-center gap-2 opacity-50 cursor-not-allowed">
              <Save size={18} /> Enregistrer la configuration
            </button>
          </div>
        </div>

        {/* OIDC Configuration */}
        <div className="bg-background-surface border border-border-light rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="p-6 border-b border-border-light bg-background-app flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Globe className="text-purple-500" size={24} />
              <h2 className="text-xl font-bold">OpenID Connect (SSO)</h2>
            </div>
            <span className="px-2 py-1 bg-secondary text-[10px] font-bold rounded uppercase tracking-wider">Inactif</span>
          </div>
          <div className="p-6 space-y-4 flex-1">
            <div className="space-y-2">
              <label className="text-sm font-medium">URL de l'Issuer</label>
              <input type="text" placeholder="https://keycloak.local/realms/bastion" className="w-full px-4 py-2 bg-background-surface border border-border-light rounded-md text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Client ID</label>
              <input type="text" placeholder="bastion-client" className="w-full px-4 py-2 bg-background-surface border border-border-light rounded-md text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Client Secret</label>
              <input type="password" placeholder="••••••••••••••••" className="w-full px-4 py-2 bg-background-surface border border-border-light rounded-md text-sm" />
            </div>
          </div>
          <div className="p-4 bg-background-app border-t border-border-light">
            <button className="btn-primary w-full flex items-center justify-center gap-2 opacity-50 cursor-not-allowed">
              <Save size={18} /> Enregistrer la configuration
            </button>
          </div>
        </div>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-3 text-blue-500">
        <AlertCircle size={20} />
        <p className="text-sm">
          Le provisioning **Just-In-Time (JIT)** est activé par défaut. Les utilisateurs s'authentifiant avec succès via ces services seront automatiquement créés avec le rôle **USER**.
        </p>
      </div>
    </div>
  );
};

export default AdminProviders;
