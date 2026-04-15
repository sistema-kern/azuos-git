import { PageLayout } from "@/components/layout/PageLayout";
import { useGetGallery } from "@workspace/api-client-react";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { Image as ImageIcon } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/ui";

export default function Galeria() {
  const { data: photos, isLoading } = useGetGallery();
  const { profile } = useCompanyProfile();
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  return (
    <PageLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-16">
          <ImageIcon className="w-16 h-16 text-primary mx-auto mb-4 opacity-50" />
          <h1 className="text-5xl md:text-7xl font-display font-bold text-white mb-4">NOSSA <span className="gold-gradient-text">GALERIA</span></h1>
          <p className="text-xl text-muted-foreground">Momentos épicos na {profile?.company_name}.</p>
        </div>

        {isLoading ? (
          <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
            {[1,2,3,4,5,6].map(i => <div key={i} className="bg-card/50 rounded-xl h-64 animate-pulse"></div>)}
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
            {photos?.map((photo) => (
              <div 
                key={photo.id} 
                className="break-inside-avoid relative group cursor-pointer overflow-hidden rounded-xl bg-card border border-white/5"
                onClick={() => setSelectedPhoto(photo.url)}
              >
                <img 
                  src={photo.url} 
                  alt={photo.caption || "Azuos Photo"} 
                  className="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-500" 
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
                  <p className="text-white font-medium text-sm">{photo.caption}</p>
                </div>
              </div>
            ))}
            {photos?.length === 0 && <p className="text-center text-muted-foreground col-span-full">Nenhuma foto adicionada ainda.</p>}
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {selectedPhoto && (
        <div 
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setSelectedPhoto(null)}
        >
          <img src={selectedPhoto} alt="Zoomed" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </PageLayout>
  );
}
