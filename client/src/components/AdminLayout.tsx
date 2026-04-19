import React from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Server, 
  Users, 
  FileText, 
  ArrowLeft,
  ShieldAlert,
  Key,
  Search,
  User,
  Sun,
  Moon
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const navItems = [
    { to: '/administration', icon: <LayoutDashboard size={20} />, label: 'Tableau de Bord', end: true },
    { to: '/administration/machines', icon: <Server size={20} />, label: 'Machines' },
    { to: '/administration/users', icon: <Users size={20} />, label: 'Utilisateurs' },
    { to: '/administration/auth', icon: <Key size={20} />, label: 'Rôles' },
    { to: '/administration/logs', icon: <FileText size={20} />, label: 'Audit' },
  ];

  const getBreadcrumb = () => {
    const path = location.pathname;
    if (path === '/administration') return 'Tableau de Bord';
    if (path.includes('/machines')) return 'Machines';
    if (path.includes('/users')) return 'Utilisateurs';
    if (path.includes('/auth')) return 'Rôles';
    if (path.includes('/logs')) return 'Audit';
    return 'Administration';
  };

  return (
    <div className="flex min-h-screen bg-background-app font-sans transition-colors duration-300">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 bottom-0 w-[250px] bg-background-surface border-r border-border-light flex flex-col z-30 transition-colors duration-300">
        <div className="h-16 px-6 flex items-center gap-3 border-b border-border-light">
          <ShieldAlert className="text-primary w-6 h-6" />
          <h2 className="font-bold text-lg text-text-main tracking-tight">Bastion-Node</h2>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors duration-200
                ${isActive 
                  ? 'bg-primary/10 text-primary font-medium' 
                  : 'text-text-secondary hover:bg-background-app hover:text-text-main'}
              `}
            >
              {item.icon}
              <span className="text-sm">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-border-light">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-text-secondary hover:text-text-main hover:bg-background-app rounded-md transition-colors"
          >
            <ArrowLeft size={18} />
            Retour au Portail
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 ml-[250px] flex flex-col">
        {/* Topbar */}
        <header className="h-16 bg-background-surface border-b border-border-light flex items-center justify-between px-8 sticky top-0 z-20 transition-colors duration-300">
          <div className="text-sm font-medium text-text-secondary">
            Administration / <span className="text-text-main">{getBreadcrumb()}</span>
          </div>
          
          <div className="flex items-center gap-6">
            <button
              onClick={toggleTheme}
              className="p-2 text-text-secondary hover:text-primary transition-colors"
              title={theme === 'light' ? 'Mode sombre' : 'Mode clair'}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral w-4 h-4" />
              <input 
                type="text" 
                placeholder="Recherche globale..." 
                className="form-input input-with-icon h-9 text-xs w-64 shadow-sm"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <User size={18} />
              </div>
              <span className="text-sm font-medium text-text-main">Admin</span>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-8">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
