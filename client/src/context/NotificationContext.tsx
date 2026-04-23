import React, { createContext, useContext, useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react';

export type NotificationType = 'error' | 'success' | 'warning' | 'info';

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  duration?: number;
}

interface NotifyInput {
  type: NotificationType;
  title: string;
  message: string;
  duration?: number;
}

interface NotificationContextType {
  notify: (input: NotifyInput) => void;
  dismiss: (id: number) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const TYPE_STYLES: Record<NotificationType, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
  error:   { bg: 'bg-red-500/10',    border: 'border-red-500/40',    text: 'text-red-500',    icon: <XCircle size={22} /> },
  success: { bg: 'bg-green-500/10',  border: 'border-green-500/40',  text: 'text-green-500',  icon: <CheckCircle2 size={22} /> },
  warning: { bg: 'bg-amber-500/10',  border: 'border-amber-500/40',  text: 'text-amber-500',  icon: <AlertTriangle size={22} /> },
  info:    { bg: 'bg-sky-500/10',    border: 'border-sky-500/40',    text: 'text-sky-500',    icon: <Info size={22} /> },
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const dismiss = useCallback((id: number) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const notify = useCallback((input: NotifyInput) => {
    const id = Date.now() + Math.random();
    const duration = input.duration ?? 6000;
    setNotifications(prev => [...prev, { id, ...input, duration }]);
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
  }, [dismiss]);

  return (
    <NotificationContext.Provider value={{ notify, dismiss }}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
        {notifications.map(n => {
          const style = TYPE_STYLES[n.type];
          return (
            <div
              key={n.id}
              className={`pointer-events-auto w-96 max-w-[calc(100vw-2rem)] ${style.bg} ${style.border} border rounded-xl shadow-xl backdrop-blur-md p-4 flex gap-3 animate-in slide-in-from-right-4 fade-in duration-300`}
              role="alert"
            >
              <div className={`${style.text} flex-shrink-0 mt-0.5`}>{style.icon}</div>
              <div className="flex-1 min-w-0">
                <h4 className={`${style.text} font-bold text-sm leading-tight`}>{n.title}</h4>
                <p className="text-text-main text-xs mt-1 leading-snug break-words">{n.message}</p>
              </div>
              <button
                onClick={() => dismiss(n.id)}
                className={`${style.text} opacity-60 hover:opacity-100 transition-opacity flex-shrink-0`}
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used within a NotificationProvider');
  return ctx;
};
