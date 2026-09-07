import { Check, ChevronLeft, ChevronRight } from 'lucide-react';

const OnboardingLayout = ({ children, currentStep, totalSteps, stepTitles, onNext, onBack, isLastStep, isSubmitting, nextDisabled }) => {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" className="h-8 w-auto" alt="" srcset="" />
            <span className="text-2xl font-bold text-gradient">DeFa</span>
          </div>
          <span className="text-sm text-gray-500">PayMate Registration</span>
        </div>
      </header>

      {/* Progress Steps */}
      {currentStep < totalSteps && (
        <div className="bg-white border-b border-gray-200 py-6">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <div className="flex items-center justify-between gap-2">
              {stepTitles.map((title, index) => (
                <div key={index} className="flex-1 flex items-center last:flex-none focus:outline-none">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${index < currentStep
                          ? 'bg-brand-gradient text-white'
                          : index === currentStep
                            ? 'bg-brand-gradient text-white ring-4 ring-brand-purple/20'
                            : 'bg-gray-200 text-gray-500'
                        }`}
                    >
                      {index < currentStep ? <Check className="w-5 h-5" /> : index + 1}
                    </div>
                  <span className={`text-xs mt-2 ${index <= currentStep ? 'text-brand-purple font-medium' : 'text-gray-400'}`}>
                      {title}
                    </span>
                  </div>
                  {index < totalSteps - 1 && (
                    <div
                      className={`flex-1 h-1 mx-4 rounded transition-all duration-500 ${index < currentStep ? 'bg-brand-gradient' : 'bg-gray-200'
                        }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Form Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        <form onSubmit={(e) => { e.preventDefault(); onNext(); }}>
          <div className="card">
            {children}
          </div>

          {/* Navigation Buttons */}
          {currentStep < totalSteps && (
            <div className="flex justify-between mt-6">
              <button
                type="button"
                onClick={onBack}
                className={`btn-secondary flex items-center gap-2 ${currentStep === 0 ? 'invisible' : ''}`}
              >
                <ChevronLeft className="w-5 h-5" />
                Back
              </button>
              <button
                type="submit"
                disabled={isSubmitting || nextDisabled}
                className="btn-brand flex items-center gap-2"
              >
                {isSubmitting ? (
                  'Submitting...'
                ) : isLastStep ? (
                  'Submit My Application'
                ) : (
                  <>
                    Next
                    <ChevronRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>
          )}
        </form>
      </main>
    </div>
  );
};

export default OnboardingLayout;
