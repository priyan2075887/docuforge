from io import BytesIO
import json
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from ..pdf_tools import PDFToolError, compose_pdf, delete_pages, extract_pages, images_to_pdf, merge_pdfs, optimize_pdf, reorder_pages, rotate_pages, split_pdf

router = APIRouter(prefix="/api/v1/pdf", tags=["PDF tools"])
MAX_SIZE = 100 * 1024 * 1024


async def payload(file: UploadFile) -> bytes:
    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(413, "File exceeds the 100 MB limit.")
    return data


def download(data: bytes, filename: str, media_type: str = "application/pdf") -> StreamingResponse:
    return StreamingResponse(BytesIO(data), media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"', "Content-Length": str(len(data))})


def failure(error: PDFToolError) -> HTTPException:
    return HTTPException(422, str(error))


@router.post("/merge")
async def merge(files: Annotated[list[UploadFile], File()]) -> StreamingResponse:
    try: return download(merge_pdfs([await payload(file) for file in files]), "merged.pdf")
    except PDFToolError as error: raise failure(error) from error


@router.post("/compose")
async def compose(files: Annotated[list[UploadFile], File()], manifest: Annotated[str, Form()]) -> StreamingResponse:
    try:
        try:
            parsed_manifest = json.loads(manifest)
        except json.JSONDecodeError as error:
            raise PDFToolError("The compose manifest is not valid JSON.") from error
        return download(compose_pdf([await payload(file) for file in files], parsed_manifest), "organized.pdf")
    except PDFToolError as error:
        raise failure(error) from error


@router.post("/extract")
async def extract(file: Annotated[UploadFile, File()], pages: Annotated[str, Form()]) -> StreamingResponse:
    try: return download(extract_pages(await payload(file), pages), "extracted-pages.pdf")
    except PDFToolError as error: raise failure(error) from error


@router.post("/delete-pages")
async def delete(file: Annotated[UploadFile, File()], pages: Annotated[str, Form()]) -> StreamingResponse:
    try: return download(delete_pages(await payload(file), pages), "pages-removed.pdf")
    except PDFToolError as error: raise failure(error) from error


@router.post("/rotate")
async def rotate(file: Annotated[UploadFile, File()], pages: Annotated[str, Form()], degrees: Annotated[int, Form()]) -> StreamingResponse:
    try: return download(rotate_pages(await payload(file), pages, degrees), "rotated.pdf")
    except PDFToolError as error: raise failure(error) from error


@router.post("/reorder")
async def reorder(file: Annotated[UploadFile, File()], order: Annotated[str, Form()]) -> StreamingResponse:
    try: return download(reorder_pages(await payload(file), order), "reordered.pdf")
    except PDFToolError as error: raise failure(error) from error


@router.post("/split")
async def split(file: Annotated[UploadFile, File()], mode: Annotated[str, Form()] = "pages", ranges: Annotated[str | None, Form()] = None) -> StreamingResponse:
    try: return download(split_pdf(await payload(file), mode, ranges), "split-pdf.zip", "application/zip")
    except PDFToolError as error: raise failure(error) from error


@router.post("/optimize")
async def optimize(file: Annotated[UploadFile, File()]) -> StreamingResponse:
    try: return download(optimize_pdf(await payload(file)), "optimized.pdf")
    except PDFToolError as error: raise failure(error) from error


@router.post("/images-to-pdf")
async def image_pdf(files: Annotated[list[UploadFile], File()]) -> StreamingResponse:
    try:
        images = [(await payload(file), (file.filename or "image.png").rsplit(".", 1)[-1]) for file in files]
        return download(images_to_pdf(images), "images.pdf")
    except PDFToolError as error: raise failure(error) from error
