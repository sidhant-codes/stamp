import { useContext } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import ArticleIcon from '@mui/icons-material/Article'
import DashboardIcon from '@mui/icons-material/Dashboard'
import EditNoteIcon from '@mui/icons-material/EditNote'
import ManageSearchIcon from '@mui/icons-material/ManageSearch'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import LogoutIcon from '@mui/icons-material/Logout'
import PersonIcon from '@mui/icons-material/Person'
import { AuthContext } from '../../context/AuthContext'
import styles from './SideBar.module.css'

const SideBar = () => {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { userInfo, logout } = useContext(AuthContext)

  const links = [
    { to: '/dashboard', label: 'Analyzer', Icon: DashboardIcon },
    { to: '/generator', label: 'Generator', Icon: EditNoteIcon },
    { to: '/history', label: 'History', Icon: ManageSearchIcon },
    { to: '/account', label: 'Account', Icon: PersonIcon },
    ...(userInfo?.role === 'admin' ? [{ to: '/admin', label: 'Admin', Icon: AdminPanelSettingsIcon }] : []),
  ]

  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  return (
    <aside className={styles.sideBar}>
      <div className={styles.brand}>
        <ArticleIcon sx={{ fontSize: 30 }} />
        <span>Stamp</span>
      </div>

      <nav className={styles.nav} aria-label="Main">
        {links.map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            aria-current={pathname === to ? 'page' : undefined}
            className={[styles.option, pathname === to ? styles.selected : ''].join(' ')}
          >
            <Icon sx={{ fontSize: 22 }} />
            <span>{label}</span>
          </Link>
        ))}
        <button type="button" onClick={handleLogout} className={`${styles.option} ${styles.logout}`}>
          <LogoutIcon sx={{ fontSize: 22 }} />
          <span>Logout</span>
        </button>
      </nav>
    </aside>
  )
}

export default SideBar
