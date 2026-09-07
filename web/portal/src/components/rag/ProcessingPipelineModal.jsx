import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { X, FileText, Globe, CheckCircle, Loader2, Eye, Search, Layers, Server, Circle, Database } from "lucide-react";
import { ragAPI } from "../../services/api";

const PIPELINE_STEPS = [
  { id: "uploading", name: "Upload to S3", description: "Uploading file to secure cloud storage", icon: <Server size={14} /> },
  { id: "queued", name: "Queued", description: "File queued for processing", icon: <Circle size={14} /> },
  { id: "partitioning", name: "Partitioning", description: "Processing and extracting text, images, and tables", icon: <FileText size={14} /> },
  { id: "chunking", name: "Chunking", description: "Creating semantic chunks", icon: <Layers size={14} /> },
  { id: "summarising", name: "Summarisation", description: "Enhancing content with AI summaries for images and tables", icon: <Search size={14} /> },
  { id: "vectorization", name: "Vectorization", description: "Generating embeddings and storing in vector database", icon: <Database size={14} /> },
  { id: "completed", name: "View Chunks", description: "View processed document chunks", icon: <CheckCircle size={14} /> },
];

export default function ProcessingPipelineModal({ document, onClose }) {
  const { projectId } = useParams();
  const [liveDocument, setLiveDocument] = useState(document);
  const [activeTab, setActiveTab] = useState("uploading");
  const [selectedChunk, setSelectedChunk] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [chunksLoading, setChunksLoading] = useState(false);

  const currentStatus = liveDocument?.processing_status || "uploading";
  const isProcessingComplete = currentStatus === "completed";
  const processingDetails = liveDocument?.processing_details || {};
  const currentStep = PIPELINE_STEPS.find((s) => s.id === activeTab);

  const getStepStatus = (stepId) => {
    const currentPos = PIPELINE_STEPS.findIndex((step) => step.id === currentStatus);
    const stepPos = PIPELINE_STEPS.findIndex((step) => step.id === stepId);

    if (stepPos < currentPos) return "completed";
    if (stepPos === currentPos) return "processing";
    return "pending";
  };

  useEffect(() => {
    if (document) {
      setLiveDocument(document);
      setSelectedChunk(null);
      setChunks([]);
    }
  }, [document?.id]);

  useEffect(() => {
    if (liveDocument) {
      setActiveTab(currentStatus);
    }
  }, [currentStatus]);

  useEffect(() => {
    if (isProcessingComplete) {
      loadChunks();
    }
  }, [isProcessingComplete, liveDocument?.id]);

  useEffect(() => {
    const pId = projectId || document?.project_id;
    const isFailed = liveDocument?.processing_status === "failed";
    if (!pId || !document?.id || isProcessingComplete || isFailed) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await ragAPI.getDocuments(pId);
        const docs = response.data?.data || response.data || [];
        if (Array.isArray(docs)) {
          const matchedDoc = docs.find((doc) => doc.id === document.id);
          if (matchedDoc) {
            setLiveDocument(matchedDoc);
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [projectId, document?.id, document?.project_id, isProcessingComplete, liveDocument?.processing_status]);

  const loadChunks = async () => {
    const pId = projectId || document?.project_id;
    if (!pId || !document?.id) return;

    try {
      setChunksLoading(true);
      const result = await ragAPI.getDocumentChunks(pId, document.id);
      const data = result.data?.data || result.data || [];
      
      const formattedChunks = data.map((chunk) => {
        const metadata = chunk.metadata || {};
        return {
          id: chunk.id || chunk._id,
          type: metadata.type || chunk.type || ["text"],
          content: chunk.content,
          original_content: metadata.original_content || chunk.original_content,
          page: metadata.page_number || metadata.page || chunk.page_number || chunk.page || 1,
          chunkIndex: chunk.chunk_index || 0,
          chars: metadata.char_count || chunk.char_count || chunk.content?.length || 0,
        };
      });
      setChunks(formattedChunks);
    } catch (error) {
      console.error("Error loading chunks:", error);
      setChunks([]);
    } finally {
      setChunksLoading(false);
    }
  };

  if (!document) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 backdrop-blur-sm bg-gray-900/40 font-sans">
      <div className="bg-white w-full max-w-6xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
        
        {/* ModalHeader */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-brand-purple/10 border border-brand-purple/20 rounded-xl flex items-center justify-center shadow-sm">
              {liveDocument?.source_url ? <Globe size={24} className="text-brand-purple" /> : <FileText size={24} className="text-brand-purple" />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">{liveDocument?.filename || liveDocument?.name}</h2>
              <p className="text-sm text-gray-500 font-medium mt-0.5">Processing Pipeline</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-800 transition-colors p-2 hover:bg-gray-100 rounded-lg">
            <X size={24} />
          </button>
        </div>

        {/* PipelineTabs */}
        <div className="border-b border-gray-100 bg-gray-50/50 px-6">
          <div className="flex space-x-0 overflow-x-auto scrollbar-none">
            {PIPELINE_STEPS.map((step) => {
              const enabled = step.id === "completed" ? isProcessingComplete : getStepStatus(step.id) !== "pending";
              const isActive = activeTab === step.id;
              
              return (
                <button
                  key={step.id}
                  onClick={() => enabled && setActiveTab(step.id)}
                  disabled={!enabled}
                  className={`flex items-center gap-2 px-5 py-4 text-sm font-bold border-b-2 transition-all whitespace-nowrap ${
                    isActive
                      ? step.id === "completed"
                        ? "border-emerald-500 text-emerald-600"
                        : "border-brand-purple text-brand-purple"
                      : enabled
                      ? "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
                      : "border-transparent text-gray-400 cursor-not-allowed opacity-50"
                  }`}
                >
                  {step.icon}
                  {step.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main Content */}
          <div className="flex-1 overflow-y-auto bg-white">
            {activeTab === "completed" && isProcessingComplete && (
              <ChunksViewer chunks={chunks} chunksLoading={chunksLoading} selectedChunk={selectedChunk} onSelectChunk={setSelectedChunk} />
            )}

            {activeTab === "partitioning" && (
              <PartitioningStep status={getStepStatus("partitioning")} elementsFound={processingDetails?.partitioning?.elements_found} />
            )}

            {activeTab === "chunking" && (
              <ChunkingStep status={getStepStatus("chunking")} chunkingData={processingDetails?.chunking} chunks={chunks} partitioningData={processingDetails?.partitioning} />
            )}

            {activeTab === "summarising" && (
              <SummarisingStep status={getStepStatus("summarising")} summarisingData={processingDetails?.summarising} />
            )}

            {!["completed", "partitioning", "chunking", "summarising"].includes(activeTab) && (
              <GenericStep stepName={currentStep?.name || "Processing"} description={currentStep?.description || "Processing step"} status={getStepStatus(activeTab)} />
            )}
          </div>

          {/* Detail Inspector */}
          <DetailInspector selectedChunk={selectedChunk} isProcessingComplete={isProcessingComplete} />
        </div>

      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------------

function GenericStep({ stepName, description, status }) {
  return (
    <div className="p-12 h-full flex flex-col items-center justify-center">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center bg-gray-50 border border-gray-100 shadow-sm">
          {status === "completed" ? (
            <CheckCircle className="w-10 h-10 text-emerald-500" />
          ) : status === "processing" ? (
            <Loader2 className="w-10 h-10 text-brand-purple animate-spin" />
          ) : (
            <div className="w-10 h-10 rounded-full border-2 border-gray-300 border-dashed" />
          )}
        </div>
        <h3 className="text-2xl font-bold text-gray-800 mb-3">{stepName}</h3>
        <p className="text-gray-500 font-medium mb-8 leading-relaxed">{description}</p>
        
        <div className={`rounded-xl p-4 border font-medium ${
          status === "completed" ? "bg-emerald-50 border-emerald-100 text-emerald-600" :
          status === "processing" ? "bg-brand-purple/5 border-brand-purple/10 text-brand-purple" :
          status === "failed" ? "bg-red-50 border-red-100 text-red-600" :
          "bg-gray-50 border-gray-200 text-gray-500"
        }`}>
          {status === "completed" ? "Step completed successfully" :
           status === "processing" ? "Currently processing..." :
           status === "failed" ? "Processing failed" :
           "Waiting for previous steps"}
        </div>
      </div>
    </div>
  );
}

function PartitioningStep({ status, elementsFound }) {
  if (!elementsFound || status !== "completed") {
    return <GenericStep stepName="Partitioning" description="Processing and extracting text, images, and tables" status={status} />;
  }

  return (
    <div className="p-8 h-full flex flex-col justify-center">
      <div className="max-w-2xl mx-auto w-full">
        <div className="text-center mb-8">
          <h3 className="text-2xl font-bold text-gray-800 mb-3">Partitioning</h3>
          <p className="text-gray-500 font-medium">Processing and extracting text, images, and tables</p>
        </div>

        <div className="mb-8 bg-brand-purple/5 border border-brand-purple/20 rounded-2xl p-6 shadow-sm">
          <h4 className="font-bold text-brand-purple mb-5 flex items-center justify-center gap-2">
            <span className="text-xl">📊</span> Elements Discovered
          </h4>
          <div className="grid grid-cols-2 gap-4 text-sm font-medium">
            {Object.entries(elementsFound).filter(([key, value]) => value > 0).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-gray-100 shadow-sm hover:border-brand-purple/20 transition-colors">
                <span className="text-gray-500 uppercase tracking-widest text-[10px] font-bold">
                  {key === "text" ? "Text sections" : key === "tables" ? "Tables" : key === "images" ? "Images" : key === "titles" ? "Titles/Headers" : "Other elements"}
                </span>
                <span className="font-bold text-lg text-gray-800">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center justify-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-500" />
          <span className="text-emerald-600 font-bold text-sm">Step completed successfully</span>
        </div>
      </div>
    </div>
  );
}

function ChunkingStep({ status, chunkingData, chunks, partitioningData }) {
  if (!chunkingData || status !== "completed") {
    return <GenericStep stepName="Chunking" description="Creating semantic chunks" status={status} />;
  }

  const sourceElements = partitioningData?.elements_found ? Object.values(partitioningData.elements_found).reduce((sum, count) => sum + count, 0) : 0;
  const avgChars = chunks.length > 0 ? Math.round(chunks.reduce((sum, chunk) => sum + chunk.chars, 0) / chunks.length) : 0;

  return (
    <div className="p-8 h-full flex flex-col justify-center">
      <div className="max-w-2xl mx-auto w-full">
        <div className="text-center mb-8">
          <h3 className="text-2xl font-bold text-gray-800 mb-3">Chunking</h3>
          <p className="text-gray-500 font-medium">Creating semantic chunks</p>
        </div>

        <div className="mb-8 bg-emerald-50 border border-emerald-100 rounded-2xl p-6 shadow-sm">
          <h4 className="font-bold text-emerald-600 mb-6 text-center text-lg">Chunking Results</h4>

          <div className="bg-white rounded-xl p-6 mb-6 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-center gap-8 text-sm">
              <div className="text-center">
                <div className="font-black text-4xl text-gray-800 mb-1">{sourceElements}</div>
                <div className="text-gray-500 uppercase tracking-widest text-[10px] font-bold">atomic elements</div>
              </div>
              <div className="text-emerald-500 text-3xl font-light">→</div>
              <div className="text-center">
                <div className="font-black text-4xl text-emerald-600 mb-1">{chunkingData.total_chunks}</div>
                <div className="text-gray-500 uppercase tracking-widest text-[10px] font-bold">chunks created</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 text-sm font-medium">
            <div className="flex items-center justify-between bg-white rounded-xl px-5 py-4 border border-gray-100 shadow-sm">
              <span className="text-gray-500 uppercase tracking-widest text-[10px] font-bold">Average chunk size</span>
              <span className="font-bold text-gray-700 bg-gray-50 px-3 py-1 rounded-lg border border-gray-200">{avgChars.toLocaleString()} characters</span>
            </div>
          </div>

          <div className="mt-5 text-xs text-emerald-600/80 text-center font-medium">
            {sourceElements} atomic elements have been chunked by title to produce {chunkingData.total_chunks} chunks
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center justify-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-500" />
          <span className="text-emerald-600 font-bold text-sm">Step completed successfully</span>
        </div>
      </div>
    </div>
  );
}

function SummarisingStep({ status, summarisingData }) {
  if (!summarisingData || status !== "completed") {
    return <GenericStep stepName="Summarisation" description="Enhancing content with AI summaries for images and tables" status={status} />;
  }

  return (
    <div className="p-8 h-full flex flex-col justify-center">
      <div className="max-w-2xl mx-auto w-full">
        <div className="text-center mb-8">
          <h3 className="text-2xl font-bold text-gray-800 mb-3">Summarisation</h3>
          <p className="text-gray-500 font-medium">Enhancing content with AI summaries for images and tables</p>
        </div>

        <div className="mb-8 bg-brand-purple/5 border border-brand-purple/10 rounded-2xl p-6 shadow-sm">
          <h4 className="font-bold text-brand-purple mb-6 text-center text-lg">AI Processing Results</h4>

          <div className="grid grid-cols-2 gap-4 text-sm font-medium">
            <div className="bg-white rounded-xl p-5 border border-gray-100 text-center shadow-sm hover:border-brand-purple/30 transition-colors">
              <div className="font-black text-3xl text-gray-800 mb-2">{summarisingData.tables_summarised || 0}</div>
              <div className="text-gray-500 uppercase tracking-widest text-[10px] font-bold">Tables Summarised</div>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-100 text-center shadow-sm hover:border-brand-purple/30 transition-colors">
              <div className="font-black text-3xl text-gray-800 mb-2">{summarisingData.images_summarised || 0}</div>
              <div className="text-gray-500 uppercase tracking-widest text-[10px] font-bold">Images Summarised</div>
            </div>
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center justify-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-500" />
          <span className="text-emerald-600 font-bold text-sm">Step completed successfully</span>
        </div>
      </div>
    </div>
  );
}

function ChunksViewer({ chunks, chunksLoading, selectedChunk, onSelectChunk }) {
  const [chunksFilter, setChunksFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredChunks = chunks.filter((chunk) => {
    const matchesFilter = chunksFilter === "all" || (Array.isArray(chunk.type) && chunk.type.includes(chunksFilter));
    const matchesSearch = chunk.content?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-gray-100 bg-white">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xl font-bold text-gray-800">Content Chunks</h3>
          <div className="text-xs font-bold text-gray-500 uppercase tracking-widest bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
            {filteredChunks.length} of {chunks.length} chunks
            {chunksLoading && <span className="text-brand-purple ml-1">(Loading...)</span>}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex gap-2 bg-gray-50 p-1 rounded-xl border border-gray-200">
            {["all", "text", "image", "table"].map((filter) => (
              <button
                key={filter}
                onClick={() => setChunksFilter(filter)}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                  chunksFilter === filter
                    ? "bg-white text-brand-purple border border-gray-200 shadow-sm"
                    : "text-gray-500 border border-transparent hover:text-gray-700"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search chunks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 pr-4 py-2.5 w-full bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-purple/30 focus:border-brand-purple/50 text-gray-800 text-sm font-medium placeholder:text-gray-400 transition-all shadow-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30 scrollbar-thin">
        {chunksLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-10 h-10 animate-spin text-brand-purple" />
              <span className="text-gray-500 font-medium">Loading chunks...</span>
            </div>
          </div>
        ) : filteredChunks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500 bg-white p-10 rounded-2xl border border-gray-200 border-dashed">
              <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="font-bold text-gray-600">No chunks found</p>
              <p className="text-xs mt-2">Try adjusting your filters or search query.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredChunks.map((chunk) => {
              const isSelected = selectedChunk?.id === chunk.id;
              return (
                <div
                  key={chunk.id}
                  onClick={() => onSelectChunk(chunk)}
                  className={`p-5 rounded-xl cursor-pointer transition-all border shadow-sm ${
                    isSelected
                      ? "border-brand-purple bg-brand-purple/5 ring-1 ring-brand-purple/20"
                      : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-md"
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {Array.isArray(chunk.type) && chunk.type.map((type) => (
                        <span key={type} className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest ${
                          type === "text" ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                          type === "image" ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/20" :
                          "bg-orange-50 text-orange-600 border border-orange-100"
                        }`}>
                          {type}
                        </span>
                      ))}
                      <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest bg-gray-100 px-2.5 py-1 rounded border border-gray-200">Page {chunk.page}</span>
                    </div>
                    <div className="text-xs font-bold text-gray-500 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200">
                      {chunk.chars} chars
                    </div>
                  </div>
                  <p className="text-sm text-gray-700 line-clamp-3 leading-relaxed font-medium">{chunk.content}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailInspector({ selectedChunk, isProcessingComplete }) {
  const [detailTab, setDetailTab] = useState("summary");

  useEffect(() => {
    setDetailTab("summary");
  }, [selectedChunk]);

  return (
    <div className="w-[400px] bg-gray-50 border-l border-gray-200 flex flex-col h-full shadow-lg z-10">
      <div className="p-6 border-b border-gray-200 bg-white">
        <h4 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <Eye size={20} className="text-brand-purple" /> Inspector
        </h4>
      </div>

      {selectedChunk ? (
        <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col">
          {(selectedChunk?.type?.includes("table") || selectedChunk?.type?.includes("image")) && (
            <div className="p-4 border-b border-gray-200 bg-gray-50/50">
              <div className="flex gap-2 bg-gray-100 p-1 rounded-xl border border-gray-200">
                <button
                  onClick={() => setDetailTab("summary")}
                  className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest rounded-lg transition-colors ${
                    detailTab === "summary" ? "bg-white text-brand-purple border border-gray-200 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Summary
                </button>
                <button
                  onClick={() => setDetailTab("original")}
                  className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest rounded-lg transition-colors ${
                    detailTab === "original" ? "bg-white text-brand-purple border border-gray-200 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Original
                </button>
              </div>
            </div>
          )}

          <div className="p-6 flex-1 bg-white">
            {detailTab === "summary" && (
              <div className="space-y-6">
                <div className="flex gap-2 flex-wrap">
                  {Array.isArray(selectedChunk.type) && selectedChunk.type.map((type) => (
                    <span key={type} className={`inline-block px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest shadow-sm ${
                      type === "text" ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                      type === "image" ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/20" :
                      "bg-orange-50 text-orange-600 border border-orange-100"
                    }`}>
                      {type}
                    </span>
                  ))}
                </div>

                <div>
                  <h5 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Chunk Content</h5>
                  <div className="text-sm text-gray-700 bg-gray-50 p-5 rounded-xl border border-gray-200 shadow-inner whitespace-pre-wrap leading-relaxed font-medium">
                    {selectedChunk.content}
                  </div>
                </div>
              </div>
            )}

            {detailTab === "original" && (
              <div className="space-y-6">
                {selectedChunk.original_content?.text && (
                  <div>
                    <h5 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Original Text</h5>
                    <div className="text-sm text-gray-700 bg-gray-50 p-5 rounded-xl border border-gray-200 shadow-inner max-h-60 overflow-y-auto scrollbar-thin whitespace-pre-wrap leading-relaxed">
                      {selectedChunk.original_content.text}
                    </div>
                  </div>
                )}

                {selectedChunk.original_content?.tables && selectedChunk.original_content.tables.length > 0 && (
                  <div>
                    <h5 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Tables ({selectedChunk.original_content.tables.length})</h5>
                    {selectedChunk.original_content.tables.map((table, index) => (
                      <div
                        key={index}
                        className="bg-white border border-gray-200 rounded-xl p-5 overflow-auto max-h-96 mb-4 text-xs text-gray-800 shadow-sm"
                        dangerouslySetInnerHTML={{ __html: table || "No table data available" }}
                      />
                    ))}
                  </div>
                )}

                {selectedChunk.original_content?.images && selectedChunk.original_content.images.length > 0 && (
                  <div>
                    <h5 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Images ({selectedChunk.original_content.images.length})</h5>
                    {selectedChunk.original_content.images.map((image, index) => (
                      <div key={index} className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex items-center justify-center shadow-sm">
                        <img
                          src={`data:image/jpeg;base64,${image}`}
                          alt={`Document image ${index + 1}`}
                          className="max-w-full h-auto rounded-lg shadow-sm"
                          style={{ maxHeight: "300px" }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6 bg-gray-50/50">
          <div className="text-center text-gray-500 bg-white p-10 rounded-2xl border border-gray-200 border-dashed w-full shadow-sm">
            <div className="w-16 h-16 bg-gray-50 border border-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-sm">
              <Eye size={28} className="text-gray-400" />
            </div>
            <p className="font-bold text-gray-600 mb-2">
              {isProcessingComplete ? "Select a chunk to inspect details" : "Awaiting chunks..."}
            </p>
            <p className="text-xs">
              {isProcessingComplete ? "Detailed view will appear here." : "Chunks will be available when processing completes."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
