import React, { useEffect, useState } from 'react';
import {
  Server,
  Users,
  ShieldCheck,
  Clock,
  Activity
} from 'lucide-react';
import api from '../services/api';
import { useLang } from '../context/LangContext';

const AdminDashboard: React.FC = () => {
  const { t } = useLang();
  const [stats, setStats] = useState({
    machines: 0,
    users: 0,
    logs: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [machinesRes, usersRes, logsRes] = await Promise.all([
          api.get('/machines'),
          api.get('/users'),
          api.get('/audit/logs'),
        ]);
        setStats({
          machines: (machinesRes.data as any).length,
          users: (usersRes.data as any).length,
          logs: (logsRes.data as any).length,
        });
      } catch (error) {
        console.error('Stats loading failed', error);
      }
    };
    fetchStats();
  }, []);

  const cards = [
    { label: t('adminDashboard.machines'), value: stats.machines, icon: <Server size={24} />, color: 'text-primary' },
    { label: t('adminDashboard.users'), value: stats.users, icon: <Users size={24} />, color: 'text-success' },
    { label: t('adminDashboard.audit'), value: stats.logs, icon: <ShieldCheck size={24} />, color: 'text-warning' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-text-main">{t('adminDashboard.title')}</h1>
        <p className="text-text-secondary mt-1 text-sm">{t('adminDashboard.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map((card) => (
          <div key={card.label} className="card-subtle p-6 flex items-center gap-4">
            <div className={`p-3 bg-background-app rounded-lg ${card.color}`}>
              {card.icon}
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{card.label}</p>
              <h3 className="text-2xl font-bold text-text-main">{card.value}</h3>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card-subtle p-6">
          <h2 className="text-text-main mb-6 flex items-center gap-2">
            <Activity className="text-primary w-5 h-5" />
            {t('adminDashboard.systemStatus')}
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-background-app rounded-md border border-border-light">
              <span className="text-sm font-medium text-text-main">{t('adminDashboard.backend')}</span>
              <span className="pill-badge bg-success/10 text-success text-[10px] uppercase font-bold">{t('adminDashboard.online')}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-background-app rounded-md border border-border-light">
              <span className="text-sm font-medium text-text-main">{t('adminDashboard.ssh')}</span>
              <span className="pill-badge bg-success/10 text-success text-[10px] uppercase font-bold">{t('adminDashboard.online')}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-background-app rounded-md border border-border-light">
              <span className="text-sm font-medium text-text-main">{t('adminDashboard.db')}</span>
              <span className="pill-badge bg-success/10 text-success text-[10px] uppercase font-bold">{t('adminDashboard.online')}</span>
            </div>
          </div>
        </div>

        <div className="card-subtle p-6 flex flex-col justify-center items-center text-center">
          <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-primary opacity-50" />
          </div>
          <h2 className="text-text-main mb-2">{t('adminDashboard.welcome')}</h2>
          <p className="text-sm text-text-secondary max-w-xs">
            {t('adminDashboard.welcomeDesc')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
