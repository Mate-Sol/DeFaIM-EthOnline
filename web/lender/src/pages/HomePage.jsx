import { KpiCard } from "../components/ui/KpiCard";
import { APP_TAGLINE } from "../libs/constants/appConfig";
import { formatCurrency } from "../libs/utils/formatters";
import { usePageTitle } from "../hooks/usePageTitle";

// New UI Components
import Button from "../components/ui/Button";
import WalletCard from "../components/ui/WalletCard";
import TabBar from "../components/navigation/TabBar";
import DataTable from "../components/ui/DataTable";
import PoolInfoCard from "../components/ui/PoolInfoCard";
import Card from "../components/ui/Card";
import Box from "../components/ui/Box";
import Typography from "../components/ui/Typography";
import InputField from "../components/ui/InputField";
import { Select } from "../components/navigation/Dropdown";
import {
  TableContainer as ModularTableContainer,
  Table as ModularTable,
  TableHead as ModularTableHead,
  TableBody as ModularTableBody,
  TableRow as ModularTableRow,
  TableCell as ModularTableCell,
  TablePagination
} from "../components/ui/Table";
import Chip from "../components/ui/Chip";

const marketSummary = [
  {
    label: "Total Value Locked",
    value: formatCurrency(128450000),
    change: 4.12,
  },
  { label: "24h Volume", value: formatCurrency(19470000), change: -1.37 },
  { label: "Active Wallets", value: "42.3K", change: 2.55 },
];

const mockTabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'agent', label: 'Agent CARA' },
  { id: 'pools', label: 'Pools' },
  { id: 'support', label: 'Customer Support' },
  { id: 'refer', label: 'Refer a Friend' },
  { id: 'loans', label: 'Loans' },
];

export function HomePage() {
  usePageTitle("Overview");

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">DeFi Overview</h1>
        <p className="mt-2 max-w-2xl text-slate-300">{APP_TAGLINE}</p>
      </header>

      {/* --- UI Components Showcase --- */}
      <div className="p-6  rounded-2xl space-y-12 bg-primary/10 ">



        {/* Inputs & Forms */}
        <section className="space-y-6">
          <Typography variant="h2" className="border-b border-white/10 pb-2">Inputs & Forms</Typography>

          <Box>
            <Typography variant="h4" className="mb-4">Search Input</Typography>
            <InputField
              placeholder="Search"
              className="max-w-md"
              leftIcon={
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              }
            />
          </Box>
        </section>

        {/* Navigation Extras */}
        <section className="space-y-6">
          <Typography variant="h2" className="border-b border-white/10 pb-2">Navigation Extras</Typography>

          <Box className="flex flex-wrap gap-12 items-start">
            <Box>
              <Typography variant="h4" className="mb-4">Select Dropdown</Typography>
              <Select
                placeholder="Select Field"
                value="total"
                options={[
                  { label: "Total Loan Amount", value: "total", icon: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
                  { label: "My Loan Amount", value: "my", icon: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
                  { label: "My Profit", value: "profit", icon: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg> },
                  { label: "Remaining Proceeds", value: "remaining", icon: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
                ]}
                className="max-w-[280px]"
              />
            </Box>
          </Box>
        </section>

        {/* Compound Visual Components */}
        <section className="space-y-8">
          <Typography variant="h2" className="border-b border-white/10 pb-2">Compound Cards & Status</Typography>

          <div>
            <h2 className="text-xl font-semibold mb-4 text-white">Card Variants</h2>
            <div className="flex flex-col md:flex-row gap-6">
              <Card variant="glass" className="max-w-md">
                <h3 className="text-xl font-medium mb-2">Glass Variant (Default)</h3>
                <p className="text-sm font-light opacity-80">This is the default glassmorphism style with backdrop blur and semi-transparent background.</p>
              </Card>
              <Card variant="simple" className="max-w-md">
                <h3 className="text-xl font-medium mb-2">Simple Variant</h3>
                <p className="text-sm font-light opacity-80">A cleaner, solid background variant without the blur effect, suitable for less emphasized sections.</p>
              </Card>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 text-white">WalletCard Component</h2>
            <WalletCard balance="99,000.00" />
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 text-white">TabBar Component</h2>
            <TabBar tabs={mockTabs} defaultActive="dashboard" />
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 text-white">Button Components</h2>
            <div className="flex flex-wrap gap-4 items-center">
              <Button variant="solid" color="primary">Login</Button>
              <Button variant="gradient" color="gray">Login</Button>
              <Button variant="solid" color="alert">Cancel</Button>
              <Button variant="solid" color="secondary">Secondary</Button>
              <Button variant="icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </Button>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 text-white">PoolInfoCard Component</h2>
            <PoolInfoCard />
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 text-white">DataTable Component</h2>
            <DataTable
              data={[
                { poolName: 'Jack L. Troupe', chainIcon: 'E', investment: '48.75', tenure: '15 Days', apy: '16%', status: 'Expired', statusColor: 'bg-expired' },
                { poolName: 'Jack L. Troupe', chainIcon: 'P', investment: '48.75', tenure: '90 Days', apy: '16%', status: 'Expired', statusColor: 'bg-expired' },
                { poolName: 'Jack L. Troupe', chainIcon: 'M', investment: '48.75', tenure: '60 Days', apy: '16%', status: 'Expired', statusColor: 'bg-expired' },
              ]}
            />
          </div>



          <div>
            <h2 className="text-xl font-semibold mb-4 text-white">Table Variants (Relaxed vs Dense)</h2>
            <Box className="space-y-8">
              <Box>
                <Typography variant="caption" className="mb-2 block opacity-70 uppercase tracking-widest">Relaxed Variant</Typography>
                <ModularTableContainer>
                  <ModularTable density="relaxed">
                    <ModularTableHead>
                      <ModularTableRow>
                        <ModularTableCell>Asset</ModularTableCell>
                        <ModularTableCell align="right">Price</ModularTableCell>
                      </ModularTableRow>
                    </ModularTableHead>
                    <ModularTableBody>
                      <ModularTableRow><ModularTableCell>Ethereum</ModularTableCell><ModularTableCell align="right">$2,450</ModularTableCell></ModularTableRow>
                      <ModularTableRow><ModularTableCell>Solana</ModularTableCell><ModularTableCell align="right">$145</ModularTableCell></ModularTableRow>
                      <ModularTableRow><ModularTableCell>Polygon</ModularTableCell><ModularTableCell align="right">$0.65</ModularTableCell></ModularTableRow>
                    </ModularTableBody>
                  </ModularTable>
                </ModularTableContainer>
              </Box>

              <Box >
                <Typography variant="caption" className="mb-2 block opacity-70 uppercase tracking-widest">Dense Variant</Typography>
                <ModularTableContainer >
                  <ModularTable density="dense">
                    <ModularTableHead>
                      <ModularTableRow>
                        <ModularTableCell>Asset</ModularTableCell>
                        <ModularTableCell align="right">Price</ModularTableCell>
                      </ModularTableRow>
                    </ModularTableHead>
                    <ModularTableBody  >
                      <ModularTableRow ><ModularTableCell >Ethereum</ModularTableCell><ModularTableCell align="right">$2,450</ModularTableCell></ModularTableRow>
                      <ModularTableRow><ModularTableCell>Ethereum</ModularTableCell><ModularTableCell align="right">$2,450</ModularTableCell></ModularTableRow>
                      <ModularTableRow><ModularTableCell>Ethereum</ModularTableCell><ModularTableCell align="right">$2,450</ModularTableCell></ModularTableRow>
                      <ModularTableRow><ModularTableCell>Ethereum</ModularTableCell><ModularTableCell align="right">$2,450</ModularTableCell></ModularTableRow>
                      <ModularTableRow><ModularTableCell>Ethereum</ModularTableCell><ModularTableCell align="right">$2,450</ModularTableCell></ModularTableRow>
                    </ModularTableBody>
                  </ModularTable>
                </ModularTableContainer>
              </Box>
            </Box>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-6 text-white">Status Indicators (Chips)</h2>
            <div className="flex flex-wrap gap-6 items-center">
              <Chip variant="low">Low Risk</Chip>
              <Chip variant="medium">Medium Risk</Chip>
              <Chip variant="high">High Risk</Chip>
            </div>
            <div className="mt-8 flex flex-wrap gap-6 items-center">
              <Chip variant="success">Success</Chip>
              <Chip variant="warning">Warning</Chip>
              <Chip variant="success"  >Error</Chip>
              <Chip dot={false}>No Dot Chip</Chip>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
