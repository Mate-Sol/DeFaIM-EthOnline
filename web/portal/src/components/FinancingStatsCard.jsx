import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const FinancingStatsCard = ({ totalLimit, creditReserve, drawableLimit, usedAmount, availableAmount }) => {
  const utilizationPercent = drawableLimit > 0 ? Math.round((usedAmount / drawableLimit) * 100) : 0;
  
  // Data for the gauge chart
  const data = [
    { name: 'Used', value: usedAmount },
    { name: 'Available', value: availableAmount },
  ];
  
  // Gradient colors matching brand
  const COLORS = ['#9e2a5b', '#e5e7eb'];
  
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="card bg-white">
      <h3 className="text-lg font-semibold mb-4">Liquidity Facility Overview</h3>
      
      <div className="flex items-center gap-8">
        {/* Gauge Chart */}
        <div className="relative w-48 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#4a1e60" />
                  <stop offset="100%" stopColor="#9e2a5b" />
                </linearGradient>
              </defs>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={75}
                startAngle={180}
                endAngle={0}
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={index === 0 ? 'url(#gaugeGradient)' : COLORS[1]}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          
          {/* Center Text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-gradient">{utilizationPercent}%</span>
            <span className="text-xs text-gray-500">Deployed</span>
          </div>
        </div>
        
        {/* Stats */}
        <div className="flex-1 space-y-4">
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-600">Total Pre-Funding Facility</span>
            <span className="font-semibold text-gray-900">{formatCurrency(totalLimit)}</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-red-50/50 rounded-lg border border-red-100">
            <span className="text-sm text-gray-500">Reserved (Locked)</span>
            <span className="font-semibold text-gray-500">{formatCurrency(creditReserve)}</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <span className="text-sm text-brand-purple font-bold">Available to Deploy</span>
            <span className="font-bold text-brand-purple">{formatCurrency(drawableLimit)}</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-amber-50 rounded-lg">
            <span className="text-sm text-amber-700">Deployed Liquidity</span>
            <span className="font-semibold text-amber-700">{formatCurrency(usedAmount)}</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
            <span className="text-sm text-green-700">Remaining Capacity</span>
            <span className="font-semibold text-green-700">{formatCurrency(availableAmount)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FinancingStatsCard;
