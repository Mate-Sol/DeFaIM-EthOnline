import { ArrowRight, Loader2, Save } from 'lucide-react';

const FormNavigation = ({ 
  handleBack, 
  handleNext, 
  handleSave, 
  currentStep, 
  stepsCount, 
  loading, 
  isSaving, 
  creditLineStatus,
  className = ""
}) => {
  return (
    <div className={`pt-8 border-t border-gray-100 flex justify-between items-center ${className}`}>
      <button
        onClick={handleBack}
        disabled={currentStep === 0 || loading}
        className="px-6 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        <ArrowRight className="w-4 h-4 rotate-180" />
        Previous
      </button>

      <div className="flex gap-3">
        {currentStep < stepsCount - 1 && (
          <>
            <button
              onClick={() => handleSave()}
              disabled={isSaving || loading || creditLineStatus === 'Approved'}
              className="px-6 py-2.5 rounded-xl border border-brand-purple text-brand-purple font-semibold hover:bg-brand-purple/5 transition-all flex items-center gap-2"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Progress
            </button>

            <button
              type="submit"
              disabled={isSaving || loading}
              className={`px-8 py-2.5 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center gap-2 ${isSaving || loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Next Step
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default FormNavigation;
