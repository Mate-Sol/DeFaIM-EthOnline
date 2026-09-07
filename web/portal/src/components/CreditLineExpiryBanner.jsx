import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, Calendar } from 'lucide-react';
import { pspAPI } from '../services/api';

const CreditLineExpiryBanner = () => {
    const [expiryInfo, setExpiryInfo] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchExpiryStatus();
    }, []);

    const fetchExpiryStatus = async () => {
        try {
            const response = await pspAPI.getCreditLineExpiry();
            setExpiryInfo(response.data);
        } catch (error) {
            console.error('Failed to fetch expiry status:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading || !expiryInfo) return null;

    const { remainingDays, isExpired, expiryDate } = expiryInfo;

    // Don't show banner if more than 30 days remaining
    if (remainingDays > 30 && !isExpired) return null;

    // Determine severity level
    const getSeverity = () => {
        if (isExpired) return 'expired';
        if (remainingDays <= 7) return 'critical';
        if (remainingDays <= 14) return 'warning';
        return 'notice';
    };

    const severity = getSeverity();

    const severityStyles = {
        expired: 'bg-red-50 border-red-200 text-red-800',
        critical: 'bg-red-50 border-red-200 text-red-800',
        warning: 'bg-amber-50 border-amber-200 text-amber-800',
        notice: 'bg-blue-50 border-blue-200 text-blue-800'
    };

    const iconColor = {
        expired: 'text-red-600',
        critical: 'text-red-600',
        warning: 'text-amber-600',
        notice: 'text-blue-600'
    };

    return (
        <div className={`mb-6 p-4 rounded-lg border-2 ${severityStyles[severity]}`}>
            <div className="flex items-start gap-3">
                <AlertTriangle className={`w-5 h-5 ${iconColor[severity]} flex-shrink-0 mt-0.5`} />
                <div className="flex-1">
                    <h3 className="font-semibold mb-1">
                        {isExpired ?
                            'Credit Line Expired' :
                            `Credit Line Expiring in ${remainingDays} ${remainingDays === 1 ? 'Day' : 'Days'}`
                        }
                    </h3>
                    <p className="text-sm mb-2">
                        {isExpired ? (
                            <>
                                Your credit line expired on{' '}
                                <span className="font-semibold">
                                    {new Date(expiryDate).toLocaleDateString('en-US', {
                                        month: 'long',
                                        day: 'numeric',
                                        year: 'numeric'
                                    })}
                                </span>
                                . New drawdowns are not permitted, but you can still repay existing financings.
                            </>
                        ) : (
                            <>
                                Your credit line will expire on{' '}
                                <span className="font-semibold">
                                    {new Date(expiryDate).toLocaleDateString('en-US', {
                                        month: 'long',
                                        day: 'numeric',
                                        year: 'numeric'
                                    })}
                                </span>
                                . Contact your Credit Risk Officer to discuss renewal options.
                            </>
                        )}
                    </p>
                    <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>Expiry: {new Date(expiryDate).toLocaleDateString()}</span>
                        </div>
                        {!isExpired && (
                            <div className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                <span>{remainingDays} days remaining</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CreditLineExpiryBanner;
