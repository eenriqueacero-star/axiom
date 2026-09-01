export interface AgentConfig {
  /** Unique identifier */
  id?: number;
  /** Display name */
  name: string;
  /** Agent role/title */
  role: string;
  /** Theme color (hex) */
  color: string;
  /** Skin color (hex) */
  skinColor?: string;
  /** Current status */
  status?: 'active' | 'busy' | 'idle';
  /** Is this the boss/lead agent? Gets crown + larger scale */
  isBoss?: boolean;
  /** Desk position override [x, y, z] */
  deskPosition?: [number, number, number];
  /** Accessory type */
  accessory?: 'sunglasses' | 'headset' | 'visor' | 'cap' | 'bowtie';
}

export interface BrandingConfig {
  /** Company name displayed on wall */
  name: string;
  /** Short logo text (1-3 chars) */
  logo?: string;
  /** Brand primary color */
  color?: string;
  /** Tagline text */
  tagline?: string;
}

export type RoomType = 'office' | 'gym' | 'breakroom' | 'boardroom' | 'serverroom' | 'rooftop';

export interface StatsConfig {
  pipeline?: string;
  funded?: string;
  deals?: number;
  [key: string]: string | number | undefined;
}

export interface DataFeedConfig {
  /** Called when a deal is closed — triggers celebration animation */
  onDealClosed?: (deal: { id: string; amount: number }) => void;
  /** Called when a new lead arrives — triggers scout animation */
  onLeadCreated?: (lead: { id: string; name: string }) => void;
  /** Send a message to an agent's speech bubble */
  onMessage?: (agentName: string, message: string) => void;
}

export interface AgentWorkspaceProps {
  /** Array of agent configurations */
  agents?: AgentConfig[];
  /** Which rooms to show (default: all) */
  rooms?: RoomType[];
  /** Company branding for the office */
  branding?: BrandingConfig;
  /** Dashboard stats shown on wall TV */
  stats?: StatsConfig;
  /** Real-time data feed callbacks */
  dataFeed?: DataFeedConfig;
  /** Enable party/dance mode */
  isPlaying?: boolean;
  /** Called when user clicks an agent */
  onAgentClick?: (agent: AgentConfig, stats: { deals: number; leads: number; revenue: string }) => void;
  /** CSS class for the container */
  className?: string;
  /** License key for pro features. Without it: 3 agents max, office room only */
  licenseKey?: string;
  /** Color theme */
  theme?: 'dark' | 'light';
}
