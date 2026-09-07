import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, DollarSign } from 'lucide-react';
import { cfoAPI } from '../services/api';

const EarnedYieldChart = () => {
    const [chartData, setChartData] = useState([]);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchEarnedYieldData();
    }, []);

    const fetchEarnedYieldData = async () => {
        try {
            const response = await cfoAPI.getEarnedYieldHistory();
            setChartData(response.data.data);
            setSummary(response.data.summary);
        } catch (error) {
            console.error('Failed to fetch earned yield history:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (value) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
        }).format(value || 0);
    };

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200">
                    <p className="font-semibold text-gray-900 mb-2">{payload[0].payload.month}</p>
                    <div className="space-y-1">
                        <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-green-600">Deployed Yield:</span>
                            <span className="font-semibold text-green-700">{formatCurrency(payload[0].value)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-blue-600">Idle Yield:</span>
                            <span className="font-semibold text-blue-700">{formatCurrency(payload[1].value)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-200">
                            <span className="text-sm font-semibold text-gray-700">Total:</span>
                            <span className="font-bold text-brand-purple">
                                {formatCurrency(payload[0].payload.totalYield)}
                            </span>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    if (loading) {
        return (
            <div className="card">
                <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-4 border-brand-purple/30 border-t-brand-purple rounded-full animate-spin" />
                </div>
            </div>
        );
    }

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-brand-purple" />
                        Monthly Yield Breakdown
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">Deployed vs. idle yield across the portfolio</p>
                </div>
                {summary && (
                    <div className="text-right">
                        <p className="text-sm text-gray-600">Total Yield</p>
                        <p className="text-2xl font-bold text-gradient">{formatCurrency(summary.totalYield)}</p>
                    </div>
                )}
            </div>

            {/* Summary Cards */}
            {summary && (
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-green-50 p-4 rounded-lg border border-green-100">
                        <div className="flex items-center gap-2 mb-1">
                            <DollarSign className="w-4 h-4 text-green-600" />
                            <span className="text-sm text-green-600 font-medium">Deployed Yield</span>
                        </div>
                        <p className="text-2xl font-bold text-green-700">{formatCurrency(summary.totalUtilizedYield)}</p>
                        <p className="text-xs text-green-600 mt-1">
                            {((summary.totalUtilizedYield / summary.totalYield) * 100).toFixed(1)}% of total
                        </p>
                    </div>

                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                        <div className="flex items-center gap-2 mb-1">
                            <DollarSign className="w-4 h-4 text-blue-600" />
                            <span className="text-sm text-blue-600 font-medium">Idle Yield</span>
                        </div>
                        <p className="text-2xl font-bold text-blue-700">{formatCurrency(summary.totalUnutilizedYield)}</p>
                        <p className="text-xs text-blue-600 mt-1">
                            {((summary.totalUnutilizedYield / summary.totalYield) * 100).toFixed(1)}% of total
                        </p>
                    </div>

                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
                        <div className="flex items-center gap-2 mb-1">
                            <TrendingUp className="w-4 h-4 text-brand-purple" />
                            <span className="text-sm text-brand-purple font-medium">Total Yield</span>
                        </div>
                        <p className="text-2xl font-bold text-brand-purple">{formatCurrency(summary.totalYield)}</p>
                        <p className="text-xs text-purple-600 mt-1">
                            Across {summary.monthsCount} {summary.monthsCount === 1 ? 'month' : 'months'}
                        </p>
                    </div>
                </div>
            )}

            {/* Chart */}
            {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                            dataKey="month"
                            stroke="#6b7280"
                            style={{ fontSize: '12px' }}
                        />
                        <YAxis
                            stroke="#6b7280"
                            style={{ fontSize: '12px' }}
                            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend
                            wrapperStyle={{ paddingTop: '20px' }}
                            iconType="square"
                        />
                        <Bar
                            dataKey="utilizedYield"
                            name="Deployed Yield"
                            fill="#10b981"
                            radius={[4, 4, 0, 0]}
                            stackId="yield"
                        />
                        <Bar
                            dataKey="unutilizedYield"
                            name="Idle Yield"
                            fill="#3b82f6"
                            radius={[4, 4, 0, 0]}
                            stackId="yield"
                        />
                    </BarChart>
                </ResponsiveContainer>
            ) : (
                <div className="text-center py-12">
                    <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No yield data available</p>
                </div>
            )}
        </div>
    );
};

export default EarnedYieldChart;
