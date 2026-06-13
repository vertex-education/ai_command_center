import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadArtifact, type ArtifactUploadResult, type ScopeLevel } from "@/lib/artifact-upload";

const scopeOptions: Array<{ value: ScopeLevel; label: string }> = [
  { value: "org", label: "Org" },
  { value: "team", label: "Team" },
  { value: "personal", label: "Personal" },
];

export function ArtifactUploader() {
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ArtifactUploadResult | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => uploadArtifact({ data: formData }),
    onSuccess: (data) => {
      setResult(data);
      formRef.current?.reset();
    },
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    uploadMutation.reset();
    await uploadMutation.mutateAsync(new FormData(event.currentTarget));
  }

  const isUploading = uploadMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isUploading) return;
        setOpen(nextOpen);
        if (nextOpen) {
          setResult(null);
          uploadMutation.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">
          <UploadCloud />
          Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload artifact</DialogTitle>
          <DialogDescription>Store the file now and queue it for background ingestion.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="artifact-file">File</Label>
            <Input id="artifact-file" name="file" type="file" required disabled={isUploading} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="artifact-scope-level">Scope level</Label>
              <select
                id="artifact-scope-level"
                name="scope_level"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                required
                disabled={isUploading}
                defaultValue="team"
              >
                {scopeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="artifact-scope-id">Scope ID</Label>
              <Input id="artifact-scope-id" name="scope_id" placeholder="team-123 or user-123" required disabled={isUploading} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="artifact-project-id">Project ID</Label>
              <Input id="artifact-project-id" name="project_id" placeholder="Optional" disabled={isUploading} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="artifact-document-type">Document type</Label>
              <Input id="artifact-document-type" name="document_type" placeholder="policy, spec, onboarding" required disabled={isUploading} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="artifact-custom-tags">Tags</Label>
            <Input id="artifact-custom-tags" name="custom_tags" placeholder="strategy, launch, compliance" disabled={isUploading} />
          </div>

          {uploadMutation.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {uploadMutation.error instanceof Error ? uploadMutation.error.message : "Upload failed."}
            </p>
          ) : null}

          {result ? (
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <div>
                <div className="font-medium">Queued for ingestion</div>
                <div className="break-all text-emerald-800">Artifact ID: {result.artifactId}</div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isUploading} onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="submit" disabled={isUploading}>
              {isUploading ? <Loader2 className="animate-spin" /> : <UploadCloud />}
              {isUploading ? "Uploading" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
